import { NavLink } from 'react-router-dom'
import { TimerIcon, GroupsIcon, ProfileIcon } from './icons'

const items = [
  { to: '/', label: 'Timer', Icon: TimerIcon },
  { to: '/groups', label: 'Groups', Icon: GroupsIcon },
  { to: '/profile', label: 'Profile', Icon: ProfileIcon },
]

export default function SideNav() {
  return (
    <nav className="hidden md:flex md:flex-col md:w-60 md:shrink-0 md:h-svh md:sticky md:top-0 md:border-r md:border-border md:px-4 md:py-8">
      <div className="px-3 mb-10">
        <span className="font-display font-semibold text-lg tracking-tight">Pace</span>
      </div>
      <div className="flex flex-col gap-1">
        {items.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                isActive ? 'bg-elevated text-text' : 'text-text-faint hover:text-text-dim'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon active={isActive} />
                <span className="text-sm font-medium">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
