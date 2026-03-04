import { LoadingPage } from '@/components/ui/loading-spinner';

export default function DashboardLoading() {
  return (
    <div className="p-8 w-full h-full flex flex-col gap-4">
      <div className="h-8 w-48 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
      <div className="flex-1 rounded-xl bg-gray-100 dark:bg-gray-900 border-2 border-dashed border-gray-200 dark:border-gray-800 flex items-center justify-center">
        <LoadingPage />
      </div>
    </div>
  );
}
