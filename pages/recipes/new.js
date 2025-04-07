import Spinner from '@components/recipe-form/spinner';
import Form from '@components/recipe-form/Form';
import Layout, { MainContent } from '@components/layout'
import styles from './index.module.css';
import { useState, useRef } from 'react';
import Button from '@components/button';
import useFetch from 'use-http'
import PhotoIcon from '@components/svg/photo';

// Helper function to resize image
const resizeImage = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
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

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Recursive function to create blob with quality adjustment
        const createBlob = (quality) => {
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
};

const NewRecipe = () => {
  const title = 'Add New Recipe';
  const [APIError, setAPIError] = useState(null);
  const [errorDetails, setErrorDetails] = useState(null);
  const [parsedRecipe, setParsedRecipe] = useState(null);
  const imageInput = useRef(null);

  const { post, response, loading, error } = useFetch(`${process.env.NEXT_PUBLIC_HOST}/api/recipe-image`, {
    cachePolicy: 'no-cache',
    timeout: 60000, // 60 second timeout
  });

  const handleImageClick = () => {
    imageInput.current.click();
  }

  const handleImageChange = async (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    // Reset error states
    setAPIError(null);
    setErrorDetails(null);

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setAPIError('Invalid file type');
      setErrorDetails('Please select an image file (JPEG, PNG, etc.).');
      return;
    }

    try {
      // Resize the image if it's too large
      const resizedBlob = await resizeImage(file);

      const formData = new FormData();
      formData.append('image', resizedBlob, file.name);

      const { result, error: apiError, details } = await post(formData);

      // Check for fetch errors first
      if (error) {
        setAPIError('Network error');
        setErrorDetails('Failed to connect to the server. Please check your internet connection and try again.');
        return;
      }

      if (apiError) {
        setAPIError(apiError);
        setErrorDetails(details);
        return;
      }

      if (!response.ok) {
        if (response.status === 504) {
          setAPIError('Processing timeout');
          setErrorDetails('The image processing took too long. Please try again with a smaller or clearer image.');
          return;
        }
        setAPIError('Failed to process image');
        setErrorDetails('An unexpected error occurred. Please try again.');
        return;
      }

      let {name, ingredients, instructions: method} = JSON.parse(result);
      let recipe = { name, ingredients, method, tags: [] }
      setParsedRecipe(recipe);
    } catch (error) {
      setAPIError('Failed to process image');
      setErrorDetails('An unexpected error occurred. Please try again.');
    }
  };

  return (
    <Layout pageTitle={title}>
      <MainContent>
        <div className={styles.headerContainer}>
          <h1 className={styles.title}>{title}</h1>
          <input
            type="file"
            id="imageInput"
            accept="image/*"
            capture="environment"
            ref={imageInput}
            className={styles.fileInput}
            onChange={handleImageChange}
          />
          <Button className="" style="blue" onClick={handleImageClick}>
            <PhotoIcon className={styles.photoIcon} />
            { !!loading && <Spinner>Processing image...</Spinner>}
          </Button>
        </div>
        { APIError && (
          <div className={styles.errorContainer}>
            <p className={styles.error}>{APIError}</p>
            { errorDetails && <p className={styles.errorDetails}>{errorDetails}</p> }
          </div>
        )}
        {
          parsedRecipe ?
            <Form initialRecipe={parsedRecipe} mode="new"/> :
            <Form mode="new"/>
        }
      </MainContent>
    </Layout>
  )
}

export default NewRecipe
