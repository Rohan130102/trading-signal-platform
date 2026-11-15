import { redirect } from 'next/navigation';

/** Signals moved to /app, the first screen after signing in, as in the phone app. Old links still work. */
export default function ActiveSignalsRedirect() {
  redirect('/app');
}
