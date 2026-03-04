'use client';

import { useState, useRef } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Camera, Loader2, User } from 'lucide-react';
import { toast } from 'sonner';

interface AvatarUploadProps {
  currentImageUrl?: string;
  onUpload: (url: string) => void;
  uploadPath: string; // e.g., "users", "agents", "admins"
  entityId: string; // e.g., user_id, agent_id
  size?: string; // Tailwind size classes, default "h-20 w-20"
  fallback?: string; // Fallback text for avatar
}

export function AvatarUpload({
  currentImageUrl,
  onUpload,
  uploadPath,
  entityId,
  size = 'h-20 w-20',
  fallback,
}: AvatarUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    if (!isUploading) {
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Formato inválido. Use: JPG, PNG, WEBP ou GIF');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Imagem muito grande. Máximo 5MB.');
      return;
    }

    // Show preview immediately
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    setIsUploading(true);

    try {
      // Upload via API
      const formData = new FormData();
      formData.append('file', file);
      formData.append('bucket', 'avatars');
      formData.append('path', `${uploadPath}`);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Erro ao fazer upload');
      }

      const data = await response.json();

      // Call the onUpload callback with the new URL
      onUpload(data.publicUrl);
      toast.success('Foto atualizada com sucesso!');
    } catch (error: any) {
      console.error('Avatar upload error:', error);
      toast.error(error.message || 'Erro ao fazer upload da imagem.');
      setPreviewUrl(null);
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const displayUrl = previewUrl || currentImageUrl;
  const initials = fallback?.slice(0, 2).toUpperCase() || 'U';

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={handleClick}
        disabled={isUploading}
        className="relative group focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#09090b] rounded-full"
      >
        <Avatar
          className={`${size} border-2 border-[#27272a] group-hover:border-blue-500 transition-colors`}
        >
          <AvatarImage src={displayUrl} alt="Avatar" className="object-cover" />
          <AvatarFallback className="bg-[#27272a] text-gray-400 text-lg">
            {fallback ? initials : <User className="h-8 w-8" />}
          </AvatarFallback>
        </Avatar>

        {/* Overlay on hover */}
        <div
          className={`absolute inset-0 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity ${isUploading ? 'opacity-100' : ''}`}
        >
          {isUploading ? (
            <Loader2 className="h-6 w-6 text-white animate-spin" />
          ) : (
            <Camera className="h-6 w-6 text-white" />
          )}
        </div>
      </button>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Small edit badge */}
      <div className="absolute -bottom-1 -right-1 bg-blue-600 rounded-full p-1.5 border-2 border-[#09090b]">
        <Camera className="h-3 w-3 text-white" />
      </div>
    </div>
  );
}
