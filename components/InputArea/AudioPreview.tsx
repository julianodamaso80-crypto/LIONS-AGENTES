'use client';

import { Trash2, Play, Pause, Send } from 'lucide-react';

interface AudioPreviewProps {
  audioUrl: string;
  isPlaying: boolean;
  audioRef: React.RefObject<HTMLAudioElement>;
  onCancel: () => void;
  onSend: () => void;
  onTogglePlay: () => void;
  onEnded: () => void;
}

export function AudioPreview({
  audioUrl,
  isPlaying,
  audioRef,
  onCancel,
  onSend,
  onTogglePlay,
  onEnded,
}: AudioPreviewProps) {
  return (
    <div className="flex items-center justify-between p-4 rounded-xl bg-[#18181b] border border-[#27272a] animate-in fade-in slide-in-from-bottom-2">
      <button
        onClick={onCancel}
        className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-full transition-colors"
        title="Descartar áudio"
      >
        <Trash2 className="w-5 h-5" />
      </button>

      <div className="flex items-center gap-3">
        <button
          onClick={onTogglePlay}
          className="p-3 bg-blue-500 hover:bg-blue-600 text-white rounded-full transition-colors shadow-lg shadow-blue-500/20"
        >
          {isPlaying ? (
            <Pause className="w-5 h-5 fill-current" />
          ) : (
            <Play className="w-5 h-5 fill-current" />
          )}
        </button>
        <span className="text-sm text-slate-300 font-medium">Áudio gravado</span>
        <audio ref={audioRef} src={audioUrl} onEnded={onEnded} className="hidden" />
      </div>

      <button
        onClick={onSend}
        className="p-2 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded-full transition-colors"
        title="Enviar áudio"
      >
        <Send className="w-5 h-5" />
      </button>
    </div>
  );
}
