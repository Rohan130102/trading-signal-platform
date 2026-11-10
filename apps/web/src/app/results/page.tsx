import { redirect } from 'next/navigation';

/** The record now lives on the About page, together with how it is measured. */
export default function ResultsPage() {
  redirect('/about#performance');
}
