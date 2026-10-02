import { useCallback, useEffect, useState } from 'react'
import { api, type DiscoveryStatus } from './api.ts'
import { Jobs } from './Jobs.tsx'
import { Preferences } from './Preferences.tsx'
import { Profile } from './Profile.tsx'
import { Icon } from './ui.tsx'

type Route = 'jobs' | 'preferences' | 'profile'
const ROUTES: { route: Route; label: string }[] = [
  { route: 'jobs', label: 'Jobs' },
  { route: 'preferences', label: 'Preferences' },
  { route: 'profile', label: 'Profile & answers' },
]

/** `#/jobs`, `#/jobs/42`, `#/jobs?stage=drafted`, `#/preferences`, `#/profile`. */
function routeFromHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? ''
  return ROUTES.some((r) => r.route === hash) ? (hash as Route) : 'jobs'
}

type Theme = 'light' | 'dark' | 'system'

function readTheme(): Theme {
  try {
    const value = localStorage.getItem('jobfinder-theme')
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

function useSystemDark(): boolean {
  const query = '(prefers-color-scheme: dark)'
  const [dark, setDark] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setDark(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return dark
}

export function App() {
  const [route, setRoute] = useState<Route>(routeFromHash)
  const [theme, setTheme] = useState<Theme>(readTheme)
  const [refreshKey, setRefreshKey] = useState(0)
  const [discovery, setDiscovery] = useState<DiscoveryStatus | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const systemDark = useSystemDark()

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.dataset.theme = theme
    try {
      if (theme === 'system') localStorage.removeItem('jobfinder-theme')
      else localStorage.setItem('jobfinder-theme', theme)
    } catch {
      /* storage unavailable: the choice lasts this visit */
    }
  }, [theme])

  useEffect(() => {
    api.health().then(
      (h) => setModel(h.llm),
      () => {},
    )
    api.discoverStatus().then(setDiscovery, () => {})
  }, [])

  useEffect(() => {
    if (!discovery?.running) return
    const timer = setInterval(() => {
      api.discoverStatus().then(
        (status) => {
          setDiscovery(status)
          if (!status.running) setRefreshKey((k) => k + 1)
        },
        () => {},
      )
    }, 1500)
    return () => clearInterval(timer)
  }, [discovery?.running])

  const startDiscovery = useCallback(() => {
    api.discover(true).then(
      () => api.discoverStatus().then(setDiscovery),
      () => {},
    )
  }, [])

  const dark = theme === 'dark' || (theme === 'system' && systemDark)
  const status = discovery?.running
    ? `Reading boards… ${discovery.log.length} done`
    : discovery?.summary
      ? `Last read: ${discovery.summary.boards} boards, ${discovery.summary.inserted} new`
      : discovery?.error
        ? `Last read failed: ${discovery.error}`
        : null

  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <a className="wordmark" href="#/jobs">
          job<span>finder</span>
        </a>
        <nav aria-label="Main">
          {ROUTES.map((r) => (
            <a key={r.route} href={`#/${r.route}`} aria-current={route === r.route ? 'page' : undefined}>
              {r.label}
            </a>
          ))}
        </nav>
        <div className="topbar-end">
          {status && (
            <span className="status" role="status">
              {status}
            </span>
          )}
          <button type="button" className="btn btn-quiet" onClick={startDiscovery} disabled={discovery?.running}>
            <Icon name="refresh" /> <span>{discovery?.running ? 'Reading…' : 'Read boards'}</span>
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setTheme(dark ? 'light' : 'dark')}
            aria-label={dark ? 'Use the light theme' : 'Use the dark theme'}
            title={dark ? 'Light theme' : 'Dark theme'}
          >
            <Icon name={dark ? 'sun' : 'moon'} />
          </button>
        </div>
      </header>
      <main id="main">
        {route === 'jobs' && <Jobs refreshKey={refreshKey} onDiscover={startDiscovery} />}
        {route === 'preferences' && <Preferences onSaved={() => setRefreshKey((k) => k + 1)} />}
        {route === 'profile' && <Profile />}
      </main>
      <footer className="footer">
        <span>
          <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>d</kbd> draft · <kbd>o</kbd> open posting · <kbd>x</kbd> not for me
        </span>
        <span>{model ? `Drafting with ${model}` : 'No model: drafts are untailored'}</span>
        <span>
          On this computer only · More boards, always on:{' '}
          <a href="https://myjobfinder.live" target="_blank" rel="noopener noreferrer">
            My Job Finder
          </a>
        </span>
      </footer>
    </div>
  )
}
