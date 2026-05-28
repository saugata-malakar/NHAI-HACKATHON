/**
 * ModelLoader
 * Loads all TFLite models from the app bundle at startup.
 * Models are bundled in android/app/src/main/assets/models/ and ios/FaceAuthOffline/models/
 *
 * Model inventory (total ≈ 7.1 MB):
 *  - blazeface_short.tflite    ~340 KB  (BlazeFace short-range face detector)
 *  - mobile_facenet.tflite     ~2.0 MB  (MobileFaceNet INT8, ArcFace loss, 512-d embedding)
 *  - face_mesh_lite.tflite     ~3.5 MB  (MediaPipe Face Mesh, 468 landmarks)
 *  - minifas_v1.tflite         ~1.3 MB  (MiniFASNet v1, passive liveness/anti-spoofing)
 */

import { loadTFLiteModel, TFLiteModel } from 'react-native-fast-tflite';

interface ModelStore {
  blazeface: TFLiteModel | null;
  facenet: TFLiteModel | null;
  facemesh: TFLiteModel | null;
  minifas: TFLiteModel | null;
}

const models: ModelStore = {
  blazeface: null,
  facenet: null,
  facemesh: null,
  minifas: null,
};

let isLoaded = false;

export const ModelLoader = {
  async loadAll(): Promise<void> {
    if (isLoaded) return;

    const [blazeface, facenet, facemesh, minifas] = await Promise.all([
      loadTFLiteModel('models/blazeface_short.tflite', {
        delegate: 'gpu',      // GPU delegate; falls back to CPU automatically
      }),
      loadTFLiteModel('models/mobile_facenet.tflite', {
        delegate: 'gpu',
      }),
      loadTFLiteModel('models/face_mesh_lite.tflite', {
        delegate: 'gpu',
      }),
      loadTFLiteModel('models/minifas_v1.tflite', {
        delegate: 'cpu',      // MiniFASNet is fast enough on CPU
      }),
    ]);

    models.blazeface = blazeface;
    models.facenet = facenet;
    models.facemesh = facemesh;
    models.minifas = minifas;
    isLoaded = true;

    console.log('[ModelLoader] All models loaded successfully.');
  },

  get(name: keyof ModelStore): TFLiteModel {
    const m = models[name];
    if (!m) throw new Error(`Model "${name}" not yet loaded. Call loadAll() first.`);
    return m;
  },

  isReady(): boolean {
    return isLoaded;
  },
};
