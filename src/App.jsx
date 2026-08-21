import { useEffect, useState, lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { useOnlineStatus } from './hooks/useOnlineStatus'
import BottomNav from './components/BottomNav'
import SideNav from './components/SideNav'
import ErrorBoundary from './components/ErrorBoundary'
import ConnectionBanner from './components/ConnectionBanner'
import { AppSplashSkeleton } from './components/Skeleton'
import Login from './pages/Login'
// Timer is the landing page — needed on first paint, so it stays a
// regular eager import. Everything else is only needed once the person
// actually navigates there, so it's split into its own chunk and loaded
// on demand — keeps the initial bundle smaller for the page almost
// everyone lands on first.
import Timer from './pages/Timer'
const Groups = lazy(() => import('./pages/Groups'))
const GroupDetail = lazy(() => import('./pages/GroupDetail'))
const Profile = lazy(() => import('./pages/Profile'))
const JoinLink = lazy(() => import('./pages/JoinLink'))

// If auth is still "loading" after this long AND the device is offline,
// stop showing a skeleton that implies "any second now" and tell the
// truth instead, with a way to retry once the connection is back.
const STUCK_TIMEOUT_MS = 8000

function RouteLoadingFallback() {
  return (
    <div className="min-h-svh flex items-center justify-center">
      <div className="w-2 h-2 rounded-full bg-accent animate-breathe" />
    </div>
  )
}

function Shell({ children }) {
  const location = useLocation()
  const isGroupDetail = /^\/groups\/[^/]+$/.test(location.pathname)
  return (
    <div className="md:flex">
      <SideNav />
      <div className="flex-1">{children}</div>
      {!isGroupDetail && <BottomNav />}
    </div>
  )
}

function StuckOfflineScreen({ onRetry }) {
  return (
    <AppSplashSkeleton>
      <div className="text-center max-w-xs animate-fade-in">
        <div className="text-sm font-semibold mb-1.5">Taking longer than usual</div>
        <p className="text-xs text-text-faint mb-6">
          It looks like your connection is slow or offline. Pace will keep trying, or you can retry now.
        </p>
        <button
          onClick={onRetry}
          className="bg-elevated border border-border hover:border-text-faint rounded-xl px-5 py-2.5 text-xs font-medium tracking-wide transition-colors"
        >
          Retry
        </button>
      </div>
    </AppSplashSkeleton>
  )
}

function Gate() {
  const { user } = useAuth()
  const location = useLocation()
  const { online } = useOnlineStatus()
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const syncViewport = () => {
      document.documentElement.style.setProperty('--pace-viewport-height', `${vv.height}px`)
    }
    syncViewport()
    vv.addEventListener('resize', syncViewport)
    vv.addEventListener('scroll', syncViewport)
    return () => {
      vv.removeEventListener('resize', syncViewport)
      vv.removeEventListener('scroll', syncViewport)
    }
  }, [])

  useEffect(() => {
    if (user !== undefined) {
      setStuck(false)
      return
    }
    const t = setTimeout(() => setStuck(!online), STUCK_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [user, online])

  if (user === undefined) {
    if (stuck) return <StuckOfflineScreen onRetry={() => window.location.reload()} />
    return <AppSplashSkeleton />
  }

  // Invite links work whether or not the person is signed in yet.
  if (location.pathname.startsWith('/join/')) {
    return (
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          <Route path="/join/:groupId" element={<JoinLink />} />
        </Routes>
      </Suspense>
    )
  }

  if (user === null) return <Login />

  return (
    <Shell>
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          <Route path="/" element={<Timer />} />
          <Route path="/groups" element={<Groups />} />
          <Route path="/groups/:groupId" element={<GroupDetail />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Shell>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <AuthProvider>
          <ConnectionBanner />
          <Gate />
        </AuthProvider>
      </HashRouter>
    </ErrorBoundary>
  )
}
