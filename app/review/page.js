export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import ReviewContent from './ReviewContent';

function LoadingSpinner() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Loading submission...</p>
      </div>
    </div>
  );
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <ReviewContent />
    </Suspense>
  );
}