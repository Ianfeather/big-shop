// Shrinks a photo before it is uploaded to /api/recipe-image, which rejects
// anything over 5MB (and would spend an OpenAI call on the pixels above that
// size for nothing). Browser-only - it goes through <canvas>.
//
// Lives here rather than in pages/recipes/new.tsx, where it used to, because
// Method Import photographs a page the same way and a second copy would be one
// more place for the size limits to drift out of step with the route's.
export function resizeImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const img = new Image();
      img.src = reader.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Calculate new dimensions while maintaining aspect ratio
        const MAX_WIDTH = 2000; // Maximum width
        const MAX_HEIGHT = 2000; // Maximum height
        const MAX_SIZE = 5 * 1024 * 1024; // 5MB in bytes

        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }

        if (height > MAX_HEIGHT) {
          width = Math.round((width * MAX_HEIGHT) / height);
          height = MAX_HEIGHT;
        }

        canvas.width = width;
        canvas.height = height;

        // A freshly created canvas's 2d context is never null in practice.
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);

        // Recursive function to create blob with quality adjustment
        const createBlob = (quality: number): Promise<Blob | null> => {
          return new Promise((resolveBlob) => {
            canvas.toBlob((blob) => {
              if (!blob) {
                resolveBlob(null);
                return;
              }

              if (blob.size <= MAX_SIZE || quality <= 0.1) {
                resolveBlob(blob);
              } else {
                // Reduce quality and try again
                createBlob(quality - 0.1).then(resolveBlob);
              }
            }, 'image/jpeg', quality);
          });
        };

        // Start with 90% quality
        createBlob(0.9)
          .then((blob) => {
            if (!blob) {
              reject(new Error('Failed to create image blob'));
              return;
            }
            resolve(blob);
          })
          .catch(reject);
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
}
