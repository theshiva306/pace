import { NavLink } from 'react-router-dom'
import { TimerIcon, GroupsIcon, ProfileIcon } from './icons'

const items = [
  { to: '/', label: 'Timer', Icon: TimerIcon },
  { to: '/groups', label: 'Groups', Icon: GroupsIcon },
  { to: '/profile', label: 'Profile', Icon: ProfileIcon },
]

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 md:hidden">
      <div className="mx-auto max-w-md px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-2">
        <div className="flex items-center justify-around bg-surface/95 backdrop-blur border border-border rounded-2xl px-2 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
          {items.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 px-5 py-1.5 rounded-xl transition-colors ${
                  isActive ? 'text-text' : 'text-text-faint'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon active={isActive} />
                  <span className={`text-[11px] tracking-wide ${isActive ? 'text-text font-medium' : 'text-text-faint'}`}>
                    {label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  )
}
