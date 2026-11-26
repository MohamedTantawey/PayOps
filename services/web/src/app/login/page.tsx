export default function Login() {
  return <main className="mx-auto max-w-md p-8"><h1 className="text-2xl font-bold">PayOps sign in</h1><p className="my-4 text-zinc-400">Use your assigned ops, finance or admin token. Sessions expire after one hour.</p><form action="/api/admin/session" method="post"><label className="block">Access token<input name="token" type="password" required autoComplete="current-password" className="my-3 w-full rounded border border-zinc-700 bg-zinc-900 p-3" /></label><button className="rounded bg-violet-600 px-5 py-3">Sign in</button></form></main>;
}
