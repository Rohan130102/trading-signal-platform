import { Redirect } from 'expo-router';

/** The middle tab opens the composer directly. This only exists because a tab needs a route. */
export default function New() {
  return <Redirect href="/compose" />;
}
