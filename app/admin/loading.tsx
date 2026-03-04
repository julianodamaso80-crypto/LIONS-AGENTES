import { LoadingPage } from '@/components/ui/loading-spinner';

export default function AdminLoading() {
  return (
    <div className="p-8 w-full h-full bg-[#0A0A0A] flex flex-col gap-4">
      <div className="h-8 w-48 bg-[#1A1A1A] rounded animate-pulse" />
      <div className="flex-1 rounded-xl bg-[#1A1A1A] border border-[#2D2D2D] flex items-center justify-center">
        <LoadingPage />
      </div>
    </div>
  );
}
