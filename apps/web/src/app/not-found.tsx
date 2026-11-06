import Link from 'next/link';
import { buttonClass } from '@/components/styles';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-sm text-center">
        <h1 className="text-[22px] font-semibold">Page not found</h1>
        <p className="mt-1 text-sm text-muted">That page does not exist, or it is not available.</p>
        <Link href="/" className={buttonClass('secondary', 'md', 'mt-4')}>
          Go to the start page
        </Link>
      </div>
    </main>
  );
}
