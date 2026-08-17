import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import BottomNav from './components/BottomNav'
import SideNav from './components/SideNav'
import Login from './pages/Login'
import Timer from './pages/Timer'
import Groups from './pages/Groups'
import GroupDetail from './pages/GroupDetail'
import Profile from './pages/Profile'
import JoinLink from './pages/JoinLink'

function Shell({ children }) {
  return (
    <div className="md:flex">
      <SideNav />
      <div className="flex-1">{children}</div>
      <BottomNav />
    </div>
  )
}

function Gate() {
  const { user } = useAuth()
  const location = useLocation()

  if (user === undefined) {
    return (
      <div className="min-h-svh flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-accent animate-breathe" />
      </div>
    )
  }

  // Invite links work whether or not the person is signed in yet.
  if (location.pathname.startsWith('/join/')) {
    return (
      <Routes>
        <Route path="/join/:groupId" element={<JoinLink />} />
      </Routes>
    )
  }

  if (user === null) return <Login />

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Timer />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/groups/:groupId" element={<GroupDetail />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </HashRouter>
  )
}
