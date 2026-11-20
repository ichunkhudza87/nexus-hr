import React, { useEffect, useState } from 'react';
import { Sidebar, type NavItemKey } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { useAuth } from './context/AuthContext';
import { MOCK_USERS } from './services/mock-data';
import { AttendancePage } from './pages/AttendancePage';
import { DepartmentsPage } from './pages/DepartmentsPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { LeavesPage } from './pages/LeavesPage';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { ReportsPage } from './pages/ReportsPage';
import { SchedulesPage } from './pages/SchedulesPage';
import { SettingsPage } from './pages/SettingsPage';
import { ShiftsPage } from './pages/ShiftsPage';
import { UserManagementPage } from './pages/UserManagementPage';

export const App: React.FC = () => {
  const { user, loading, switchRole, logout } = useAuth();
  const [currentTab, setCurrentTab] = useState<NavItemKey>('overview');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab') as NavItemKey | null;
    const roleParam = params.get('role');
    const menuParam = params.get('menu');
    const logoutParam = params.get('logout');

    if (logoutParam === 'true') {
      logout();
      return;
    }

    if (roleParam === 'superadmin' || roleParam === 'manager' || roleParam === 'employee') {
      const targetUser = MOCK_USERS[roleParam];
      if (targetUser) {
        switchRole(targetUser.role);
      }
    }

    if (tabParam) {
      setCurrentTab(tabParam);
    }

    if (menuParam === 'open') {
      setMobileSidebarOpen(true);
    }
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-slate-300 font-medium tracking-wide">
            Memuat Sistem NEXUS HR Enterprise...
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const renderContent = () => {
    switch (currentTab) {
      case 'overview':
        return <OverviewPage />;
      case 'employees':
        return <EmployeesPage />;
      case 'departments':
        return <DepartmentsPage />;
      case 'shifts':
        return <ShiftsPage />;
      case 'schedules':
        return <SchedulesPage />;
      case 'attendance':
        return <AttendancePage />;
      case 'leaves':
        return <LeavesPage />;
      case 'reports':
        return <ReportsPage />;
      case 'users':
        return <UserManagementPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <OverviewPage />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Sidebar Navigasi Utama */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={(tab) => {
          setCurrentTab(tab);
          setMobileSidebarOpen(false);
        }}
        isOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      {/* Kontainer Konten Aplikasi */}
      <div className="flex-1 flex flex-col min-w-0 w-full min-h-screen overflow-x-hidden">
        <Topbar
          currentTab={currentTab}
          onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {renderContent()}
        </main>
      </div>
    </div>
  );
};

export default App;
