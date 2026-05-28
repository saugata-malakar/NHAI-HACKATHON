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

import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';

interface ModelStore {
  blazeface: TensorflowModel | null;
  facenet: TensorflowModel | null;
  facemesh: TensorflowModel | null;
  minifas: TensorflowModel | null;
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
      loadTensorflowModel({ url: 'models/blazeface_short.tflite' }, 'android-gpu'),
      loadTensorflowModel({ url: 'models/mobile_facenet.tflite' }, 'android-gpu'),
      loadTensorflowModel({ url: 'models/face_mesh_lite.tflite' }, 'android-gpu'),
      loadTensorflowModel({ url: 'models/minifas_v1.tflite' }, 'default'),
    ]);

    models.blazeface = blazeface;
    models.facenet = facenet;
    models.facemesh = facemesh;
    models.minifas = minifas;
    isLoaded = true;

    console.log('[ModelLoader] All models loaded successfully.');
  },

  get(name: keyof ModelStore): TensorflowModel {
    const m = models[name];
    if (!m) throw new Error(`Model "${name}" not yet loaded. Call loadAll() first.`);
    return m;
  },

  isReady(): boolean {
    return isLoaded;
  },
};
