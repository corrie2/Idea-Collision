import { Link, useLocation } from 'react-router-dom'

const NAV_ITEMS = [
  { path: '/', label: '碰撞工坊', icon: '' },
  { path: '/materials', label: '素材库', icon: '' },
  { path: '/history', label: '历史记录', icon: '' },
  { path: '/knowledge', label: '知识库', icon: '' },
]

export default function Navbar() {
  const location = useLocation()

  return (
    <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 no-underline">
            <span className="text-xl font-bold text-amber-500">IC</span>
            <span className="text-base font-semibold text-gray-900 tracking-tight">
              Idea Collision
            </span>
          </Link>

          {/* Nav links */}
          <div className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive = item.path === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.path)

              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`
                    px-3 py-1.5 rounded-full text-sm no-underline transition-all duration-200
                    ${isActive
                      ? 'bg-amber-50 text-amber-700 font-medium'
                      : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                    }
                  `}
                >
                  <span className="mr-1">{item.icon}</span>
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </nav>
  )
}
