# ============================================================================
# NEXUS HR — SECURE LOCAL DATABASE CREDENTIAL & PROVISIONING RUNNER
# ============================================================================
# Batasan Keamanan:
# 1. Password diminta secara masked (Read-Host -AsSecureString).
# 2. Connection string dibuat HANYA di memori proses ($env:BRANCH_A_DIRECT_DB_URL).
# 3. Menggunakan PtrToStringBSTR, memori di-zeroed seketika dengan ZeroFreeBSTR.
# 4. Menjalankan PREVIEW terlebih dahulu.
# 5. Tidak mencetak password, connection string, atau credential.
# 6. Tidak menulis credential ke file disk apa pun.
# 7. Memerlukan konfirmasi teks eksplisit ('SETUJU') sebelum menjalankan EXECUTE.
# 8. Membersihkan process environment variable saat proses selesai/batal.
# ============================================================================

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$gatewayDir = Split-Path -Parent $scriptDir
Set-Location $gatewayDir

Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " NEXUS HR — SECURE LOCAL HMAC PROVISIONING RUNNER" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "Target Host : aws-1-ap-southeast-1.pooler.supabase.com (Port 5432)"
Write-Host "User        : postgres.uneycmbqqpkifwhwzbes"
Write-Host "Target DB   : postgres"
Write-Host "Scope       : Process Memory Only (Tidak disimpan ke Registry/File)"
Write-Host "TLS Cert    : certs/supabase-ca.crt (rejectUnauthorized: true)"
Write-Host "---------------------------------------------------------------"

$securePass = Read-Host -Prompt "Masukkan Password Database Branch A (masked)" -AsSecureString

if ($null -eq $securePass -or $securePass.Length -eq 0) {
    Write-Host "[ABORTED] Tidak ada password yang dimasukkan. Proses dibatalkan." -ForegroundColor Yellow
    exit 1
}

try {
    # 3. Gunakan PtrToStringBSTR
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePass)
    $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    $encoded = [System.Uri]::EscapeDataString($plain)

    # 2. Connection string dibuat hanya di memori proses
    # 4. Set BRANCH_A_DIRECT_DB_URL hanya pada Process Environment (aws-1 cluster)
    $env:BRANCH_A_DIRECT_DB_URL = "postgresql://postgres.uneycmbqqpkifwhwzbes:$encoded@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"

    # Pembersihan memori plain-text seketika
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    $plain = $null
    $encoded = $null

    Write-Host "`n[1/2] Menjalankan Mode PREVIEW (Read-Only Connection & Contract Check)..." -ForegroundColor Cyan
    # 5. Jalankan PREVIEW terlebih dahulu
    node scripts/provision-hmac.ts --preview

    if ($LASTEXITCODE -ne 0) {
        Write-Host "`n[FAIL] Mode PREVIEW gagal. Periksa koneksi atau kredensial database." -ForegroundColor Red
        exit $LASTEXITCODE
    }

    Write-Host "`n---------------------------------------------------------------"
    Write-Host "PERSETUJUAN EKSPLISIT OPERATOR DIPERLUKAN SEBELUM EXECUTE" -ForegroundColor Yellow
    Write-Host "Periksa hasil PREVIEW di atas. Apakah Anda menyetujui eksekusi provisioning"
    Write-Host "HMAC key 'gw-hmac-v1' ke database Branch A dan gateway/.env sekarang?"
    Write-Host "---------------------------------------------------------------"
    $confirm = Read-Host -Prompt "Ketik 'SETUJU' untuk melanjutkan ke EXECUTE, atau tekan Enter untuk batal"

    # 8. Pastikan proses dapat melanjutkan provisioning EXECUTE hanya setelah persetujuan eksplisit operator
    if ($confirm -eq "SETUJU") {
        Write-Host "`n[2/2] Persetujuan diterima. Menjalankan Mode EXECUTE..." -ForegroundColor Green
        $env:NEXUS_ALLOW_HMAC_PROVISION = "true"
        node scripts/provision-hmac.ts --execute --confirm-safety

        if ($LASTEXITCODE -eq 0) {
            Write-Host "`n[SUCCESS] Provisioning selesai dan terverifikasi secara aman!" -ForegroundColor Green
        } else {
            Write-Host "`n[FAIL] Eksekusi provisioning mengalami kegagalan." -ForegroundColor Red
        }
    } else {
        Write-Host "`n[INFO] Persetujuan tidak diberikan ('$confirm'). Mode EXECUTE tidak dijalankan." -ForegroundColor Yellow
    }
} finally {
    # Pembersihan process environment variable
    $env:BRANCH_A_DIRECT_DB_URL = $null
    $env:NEXUS_ALLOW_HMAC_PROVISION = $null
    Write-Host "`n[CLEANUP] Memory process environment telah dibersihkan." -ForegroundColor Gray
}
