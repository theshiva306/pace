import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Logo, LogoMark } from './Logo'
import { TimerIcon, GroupsIcon, ProfileIcon } from './icons'

const items = [
  { to: '/', label: 'Timer', Icon: TimerIcon },
  { to: '/groups', label: 'Groups', Icon: GroupsIcon },
  { to: '/profile', label: 'Profile', Icon: ProfileIcon },
]

const STORAGE_KEY = 'pace:sidebarCollapsed'

function CollapseIcon({ collapsed }) {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none"
      className={`transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`}
    >
      <path d="M15 5L9 12l6 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function SideNav() {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0') } catch { /* ignore */ }
  }, [collapsed])

  return (
    <nav
      className={`hidden md:flex md:flex-col md:shrink-0 md:h-svh md:sticky md:top-0 md:border-r md:border-border md:py-8 transition-[width] duration-200 ease-out ${
        collapsed ? 'md:w-[76px] md:px-3' : 'md:w-60 md:px-4'
      }`}
    >
      <div className={`flex items-center mb-10 ${collapsed ? 'justify-center px-0' : 'justify-between px-3'}`}>
        {collapsed ? (
          <LogoMark size={24} />
        ) : (
          <Logo size={22} />
        )}
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            aria-label="Collapse sidebar"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-text-faint hover:text-text hover:bg-elevated transition-colors"
          >
            <CollapseIcon collapsed={false} />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {items.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              `flex items-center gap-3 py-2.5 rounded-xl transition-colors ${
                collapsed ? 'justify-center px-0' : 'px-3'
              } ${isActive ? 'bg-elevated text-text' : 'text-text-faint hover:text-text-dim'}`
            }
          >
            {({ isActive }) => (
              <>
                <Icon active={isActive} />
                {!collapsed && <span className="text-sm font-medium">{label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </div>

      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          aria-label="Expand sidebar"
          className="mt-auto w-7 h-7 self-center rounded-lg flex items-center justify-center text-text-faint hover:text-text hover:bg-elevated transition-colors"
        >
          <CollapseIcon collapsed />
        </button>
      )}
    </nav>
  )
}
