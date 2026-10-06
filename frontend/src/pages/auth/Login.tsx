import { Link } from 'react-router-dom'
import { LoginForm } from './LoginForm'

export function Login() {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Minimal header */}
      <header className="border-b border-slate-100 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link
            to="/"
            className="text-xl font-semibold tracking-tight text-slate-900"
            aria-label="Lenis home"
          >
            Lenis
          </Link>
          <p className="text-sm text-slate-500">
            No account?{' '}
            <Link
              to="/sign-up"
              className="font-medium text-slate-900 underline underline-offset-2 hover:text-slate-700"
            >
              Sign up
            </Link>
          </p>
        </div>
      </header>

      {/* Form centred on page */}
      <main className="flex items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Welcome back
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Log in to your Lenis account
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
            <LoginForm />
          </div>

          <p className="mt-6 text-center text-xs text-slate-400">
            By logging in you agree to our{' '}
            <span className="underline underline-offset-2">Terms of Service</span> and{' '}
            <span className="underline underline-offset-2">Privacy Policy</span>.
          </p>
        </div>
      </main>
    </div>
  )
}
