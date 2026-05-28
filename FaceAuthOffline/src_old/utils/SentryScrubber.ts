import { EdgeLogger } from './EdgeLogger';

export const SentryScrubber = {
  init(): void {
    try {
      const Sentry = require('@sentry/react-native');
      Sentry.init({
        dsn: 'https://ea6d74b9012f455bbce3ff15291a134a@o45056789.ingest.sentry.io/45056789',
        beforeSend(event: any) {
          // Recursive scrubber function to clean sensitive fields
          const scrub = (obj: any): any => {
            if (!obj || typeof obj !== 'object') return obj;
            
            if (Array.isArray(obj)) {
              return obj.map(scrub);
            }
            
            const scrubbed: any = {};
            for (const key in obj) {
              if (Object.prototype.hasOwnProperty.call(obj, key)) {
                const lowerKey = key.toLowerCase();
                
                // Scrub sensitive fields: embedding, similarity, userId, photo_uri, base64 images
                if (
                  lowerKey.includes('embedding') || 
                  lowerKey.includes('similarity') || 
                  lowerKey.includes('userid') ||
                  lowerKey.includes('photo_uri') ||
                  lowerKey.includes('b64') ||
                  (typeof obj[key] === 'string' && (
                    obj[key].startsWith('data:image/') || 
                    obj[key].length > 1000 // typical of long base64 buffers
                  ))
                ) {
                  scrubbed[key] = '[SCRUBBED_BIOMETRIC_DATA]';
                  EdgeLogger.sec('SentryScrubber', `Biometric leak prevented. Scrubbed field: ${key}`);
                } else {
                  scrubbed[key] = scrub(obj[key]);
                }
              }
            }
            return scrubbed;
          };
          
          if (event.extra) event.extra = scrub(event.extra);
          if (event.breadcrumbs) {
            event.breadcrumbs = event.breadcrumbs.map((breadcrumb: any) => {
              if (breadcrumb.data) {
                breadcrumb.data = scrub(breadcrumb.data);
              }
              return breadcrumb;
            });
          }
          
          return event;
        }
      });
      EdgeLogger.info('SentryScrubber', 'Sentry initialized with strict biometric data scrubbing filters.');
    } catch (err) {
      console.log('[SentryScrubber] Sentry not available in this environment. Using mock fallback.');
    }
  }
};
