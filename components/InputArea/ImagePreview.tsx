'use client';

import { X } from 'lucide-react';

interface ImagePreviewProps {
  imageUrl: string;
  uploading: boolean;
  onRemove: () => void;
}

export function ImagePreview({ imageUrl, uploading, onRemove }: ImagePreviewProps) {
  return (
    <div className="mb-3 relative inline-block">
      <div className="relative group">
        <img
          src={imageUrl}
          alt="Preview"
          className="max-h-32 rounded-lg border-2 border-blue-500/50 shadow-lg"
        />
        <button
          onClick={onRemove}
          className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 shadow-lg transition-all"
          title="Remover imagem"
        >
          <X className="h-4 w-4" />
        </button>
        {uploading && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-lg">
            <div className="text-white text-sm">Enviando...</div>
          </div>
        )}
      </div>
    </div>
  );
}
