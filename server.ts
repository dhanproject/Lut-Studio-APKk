import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import JSZip from 'jszip';
import cors from 'cors';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Load config
const firebaseConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf-8'));

// Initialize Firebase Admin (Required for Auth token verification)
let firebaseApp;
if (getApps().length === 0) {
  firebaseApp = initializeApp({
    projectId: firebaseConfig.projectId
  });
} else {
  firebaseApp = getApps()[0];
}

const authAdmin = getAuth(firebaseApp);

const app = express();
const PORT = 3000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept', 'X-Requested-With']
}));
app.options('*', cors());
app.use((req, res, next) => {
  // Prevent excessive logging to avoid buffer overflow in logs
  if(req.url !== '/api/jobs' && req.method !== 'OPTIONS') {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  }
  next();
});

// Configure larger parsing limits for mobile base64/formData buffering
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb', parameterLimit: 100000 }));


// Auth Middleware
const authenticate = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await authAdmin.verifyIdToken(idToken);
    (req as any).user = decodedToken;
    next();
  } catch (error: any) {
    console.error('[Auth] Token Verification Error:', error.message || error);
    res.status(401).json({ error: 'Invalid token', details: error.message });
  }
};

// Ensure directories exist
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const PROCESSED_DIR = path.join(process.cwd(), 'processed');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
if (!fs.existsSync(PROCESSED_DIR)) fs.mkdirSync(PROCESSED_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB per image to prevent Android broken pipes
});

// LUT Data Store (In-memory for simplicity in this demo)
const luts: Record<string, {
  data: Float32Array;
  size: number;
  title: string;
  min: [number, number, number];
  max: [number, number, number];
}> = {};

// Job Store (In-memory)
const jobs: Record<string, any> = {};

// Background Process Logic
async function processBatchInBackground(jobId: string, userId: string, files: Express.Multer.File[], lutId: string, options: any) {
  const lut = luts[lutId];
  const { intensity = 1.0, quality = 85, format = 'original', maxDimension = 'original', sharpen = 'false', prefix = 'LUT_Export' } = options;
  const intensityNum = parseFloat(intensity);
  const isSharpen = sharpen === 'true';

  try {
    jobs[jobId] = {
      ...jobs[jobId],
      status: 'processing',
      updatedAt: new Date().toISOString()
    };

    let count = 0;
    for (const file of files) {
      let image = sharp(file.path);
      const metadata = await image.metadata();

      if (maxDimension !== 'original') {
        const dim = parseInt(maxDimension);
        image = image.resize(dim, dim, { fit: 'inside', withoutEnlargement: true });
      }

      if (isSharpen) {
        image = image.sharpen(); // Basic auto-sharpen
      }

      const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

      for (let i = 0; i < data.length; i += info.channels) {
        const pixel = data.subarray(i, i + 3);
        applyLUT(pixel, lut, intensityNum);
      }

      let outputFormat = format === 'original' ? metadata.format : format;
      if (!outputFormat) outputFormat = 'jpeg';

      const outputImage = sharp(data, {
        raw: { width: info.width, height: info.height, channels: info.channels }
      });

      let finalBuffer;
      if (outputFormat === 'png') {
        finalBuffer = await outputImage.png().toBuffer();
      } else {
        finalBuffer = await outputImage.jpeg({ quality: parseInt(quality) }).toBuffer();
      }

      const ext = outputFormat === 'jpeg' ? 'jpg' : outputFormat;
      const originalName = path.parse(file.originalname).name;
      const safePrefix = prefix.replace(/[^a-z0-9_-]/gi, '_');
      const fileName = `${safePrefix}${originalName}_${count}.${ext}`;
      const filePath = path.join(PROCESSED_DIR, fileName);
      
      fs.writeFileSync(filePath, finalBuffer);
      
      const processedUrl = `/api/processed/${fileName}`;
      if (!jobs[jobId].files) jobs[jobId].files = [];
      jobs[jobId].files.push(processedUrl);
      
      fs.unlinkSync(file.path);

      count++;
      const progress = Math.round((count / files.length) * 100);
      
      jobs[jobId] = {
        ...jobs[jobId],
        progress,
        processedCount: count,
        updatedAt: new Date().toISOString()
      };
    }

    jobs[jobId] = {
      ...jobs[jobId],
      status: 'completed',
      progress: 100,
      updatedAt: new Date().toISOString()
    };

  } catch (err: any) {
    console.error('Batch Job Error:', err);
    if (jobs[jobId]) {
      jobs[jobId] = {
        ...jobs[jobId],
        status: 'failed',
        error: err.message,
        updatedAt: new Date().toISOString()
      };
    }
    // Cleanup remaining files
    files.forEach(f => {
      if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
    });
  }
}

// Clean up uploads and processed files periodically (hourly)
setInterval(() => {
  const now = Date.now();
  [UPLOADS_DIR, PROCESSED_DIR].forEach(dir => {
    fs.readdir(dir, (err, files) => {
      if (err) return;
      files.forEach(file => {
        const filePath = path.join(dir, file);
        fs.stat(filePath, (err, stats) => {
          if (!err && (now - stats.mtimeMs > 3600000)) {
            fs.unlink(filePath, () => {});
          }
        });
      });
    });
  });
}, 3600000);

function parseCubeLUT(content: string) {
  const lines = content.split(/\r?\n/);
  let size = 0;
  let title = 'Untitled LUT';
  let min: [number, number, number] = [0, 0, 0];
  let max: [number, number, number] = [1, 1, 1];
  const dataPoints: number[] = [];

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('TITLE')) {
      title = line.split('"')[1] || line.split('TITLE ')[1] || title;
    } else if (line.startsWith('LUT_3D_SIZE')) {
      size = parseInt(line.split(/\s+/)[1]);
    } else if (line.startsWith('DOMAIN_MIN')) {
      min = line.split(/\s+/).slice(1).map(Number) as [number, number, number];
    } else if (line.startsWith('DOMAIN_MAX')) {
      max = line.split(/\s+/).slice(1).map(Number) as [number, number, number];
    } else {
      const coords = line.split(/\s+/).map(Number);
      if (coords.length === 3 && !coords.some(isNaN)) {
        dataPoints.push(...coords);
      }
    }
  }

  if (size === 0) throw new Error('Invalid or missing LUT_3D_SIZE');
  
  return {
    data: new Float32Array(dataPoints),
    size,
    title,
    min,
    max
  };
}

function applyLUT(pixel: Buffer, lut: typeof luts[string], intensity: number) {
  const r = pixel[0] / 255;
  const g = pixel[1] / 255;
  const b = pixel[2] / 255;

  // Scale to [0, size-1]
  const size = lut.size;
  const scaledR = r * (size - 1);
  const scaledG = g * (size - 1);
  const scaledB = b * (size - 1);

  const x0 = Math.floor(scaledR);
  const y0 = Math.floor(scaledG);
  const z0 = Math.floor(scaledB);
  
  const x1 = Math.min(x0 + 1, size - 1);
  const y1 = Math.min(y0 + 1, size - 1);
  const z1 = Math.min(z0 + 1, size - 1);

  const dx = scaledR - x0;
  const dy = scaledG - y0;
  const dz = scaledB - z0;

  const getLUTVal = (x: number, y: number, z: number) => {
    const idx = (z * size * size + y * size + x) * 3;
    return [lut.data[idx], lut.data[idx + 1], lut.data[idx + 2]];
  };

  const v000 = getLUTVal(x0, y0, z0);
  const v100 = getLUTVal(x1, y0, z0);
  const v010 = getLUTVal(x0, y1, z0);
  const v110 = getLUTVal(x1, y1, z0);
  const v001 = getLUTVal(x0, y0, z1);
  const v101 = getLUTVal(x1, y0, z1);
  const v011 = getLUTVal(x0, y1, z1);
  const v111 = getLUTVal(x1, y1, z1);

  const lerp = (a: number[], b: number[], t: number) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ];

  const c00 = lerp(v000, v100, dx);
  const c10 = lerp(v010, v110, dx);
  const c01 = lerp(v001, v101, dx);
  const c11 = lerp(v011, v111, dx);

  const c0 = lerp(c00, c10, dy);
  const c1 = lerp(c01, c11, dy);

  const final = lerp(c0, c1, dz);

  // Apply intensity (Support for Boost/Overdrive up to 300%)
  pixel[0] = Math.max(0, Math.min(255, Math.round((r + (final[0] - r) * intensity) * 255)));
  pixel[1] = Math.max(0, Math.min(255, Math.round((g + (final[1] - g) * intensity) * 255)));
  pixel[2] = Math.max(0, Math.min(255, Math.round((b + (final[2] - b) * intensity) * 255)));
}

// API Routes
app.post('/api/upload-lut-base64', authenticate, (req: express.Request, res: express.Response) => {
  try {
    const { data, filename } = req.body;
    if (!data) return res.status(400).json({ error: 'No data provided' });
    
    // Parse the base64 payload (data:application/octet-stream;base64,....)
    const base64Content = data.split(';base64,').pop();
    const content = Buffer.from(base64Content, 'base64').toString('utf-8');
    
    const lut = parseCubeLUT(content);
    if(!lut.title) lut.title = filename;
    
    const id = uuidv4();
    luts[id] = lut;
    res.json({ id, title: lut.title, size: lut.size, points: lut.data.length / 3 });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/upload-lut', authenticate, upload.single('lut'), (req: express.Request, res: express.Response) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const content = fs.readFileSync(file.path, 'utf-8');
    const lut = parseCubeLUT(content);
    const id = uuidv4();
    luts[id] = lut;
    
    // Clean up file immediately
    fs.unlinkSync(file.path);

    res.json({ id, title: lut.title, size: lut.size, points: lut.data.length / 3 });
  } catch (err: any) {
    if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/preview', upload.single('image'), async (req: express.Request, res: express.Response) => {
  const { lutId, intensity = 1.0 } = req.body;
  const lut = luts[lutId];
  const file = req.file;

  if (!lut || !file) return res.status(400).json({ error: 'Missing LUT or image' });

  try {
    const intensityNum = parseFloat(intensity);
    const image = sharp(file.path);
    const { data, info } = await image
      .resize(1200, 1200, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    for (let i = 0; i < data.length; i += info.channels) {
      const pixel = data.subarray(i, i + 3);
      applyLUT(pixel, lut, intensityNum);
    }

    const outputBuffer = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: info.channels }
    })
    .jpeg({ quality: 90 })
    .toBuffer();

    // Clean up file
    fs.unlinkSync(file.path);

    res.json({ base64: `data:image/jpeg;base64,${outputBuffer.toString('base64')}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/process-batch-base64', authenticate, async (req: express.Request, res: express.Response) => {
  const { lutId, intensity = 1.0, quality = 85, format = 'original', maxDimension = 'original', images, sharpen, prefix } = req.body;
  const lut = luts[lutId];
  const user = (req as any).user;

  if (!lut || !images || images.length === 0) {
    return res.status(400).json({ error: 'Missing LUT or images' });
  }

  try {
    const jobId = uuidv4();
    
    jobs[jobId] = {
      id: jobId,
      userId: user.uid,
      status: 'pending',
      progress: 0,
      totalFiles: images.length,
      processedCount: 0,
      lutId,
      intensity: parseFloat(intensity),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      files: []
    };

    console.log(`[Memory] Job Base64 ${jobId} initialized`);

    // We write them to disk so the background job can process them just like multer files
    const pseudoFiles = images.map((img: any) => {
        const base64Content = img.data.split(';base64,').pop();
        const buffer = Buffer.from(base64Content, 'base64');
        const filePath = path.join(UPLOADS_DIR, `${uuidv4()}-${img.name || 'image.jpg'}`);
        fs.writeFileSync(filePath, buffer);
        return { path: filePath, originalname: img.name || 'image.jpg' } as Express.Multer.File;
    });

    processBatchInBackground(jobId, user.uid, pseudoFiles, lutId, { intensity, quality, format, maxDimension, sharpen, prefix });

    res.json({ jobId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/process-batch', authenticate, upload.array('images'), async (req: express.Request, res: express.Response) => {
  const { lutId, intensity = 1.0, quality = 85, format = 'original', maxDimension = 'original' } = req.body;
  const lut = luts[lutId];
  const files = req.files as Express.Multer.File[];
  const user = (req as any).user;

  if (!lut || !files || files.length === 0) {
    return res.status(400).json({ error: 'Missing LUT or images' });
  }

  try {
    const jobId = uuidv4();
    
    // Create Job in Memory
    jobs[jobId] = {
      id: jobId,
      userId: user.uid,
      status: 'pending',
      progress: 0,
      totalFiles: files.length,
      processedCount: 0,
      lutId,
      intensity: parseFloat(intensity),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      files: []
    };

    console.log(`[Memory] Job ${jobId} initialized`);

    // Start background process
    processBatchInBackground(jobId, user.uid, files, lutId, { intensity, quality, format, maxDimension });

    res.json({ jobId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/jobs', authenticate, async (req: express.Request, res: express.Response) => {
  const user = (req as any).user;
  try {
    // Filter jobs by userId from memory and sort by date
    const userJobs = Object.values(jobs)
      .filter(j => j.userId === user.uid)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10);
    
    res.json({ jobs: userJobs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// New endpoint for individual job polling
app.get('/api/jobs/:jobId', authenticate, (req: express.Request, res: express.Response) => {
  const jobId = req.params.jobId;
  const user = (req as any).user;
  const job = jobs[jobId];

  if (!job || job.userId !== user.uid) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json(job);
});

app.get('/api/download/:jobId', (req, res) => {
  res.status(400).json({ error: 'Use individual image URLs provided in the job status.' });
});

app.use('/api/processed', express.static(PROCESSED_DIR));

app.get('/api/raw-source', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.sendFile(path.join(process.cwd(), 'index.html'));
});

// Serve Frontend
const distPath = path.join(process.cwd(), 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  // Dev mode: serve from root
  app.use(express.static(process.cwd()));
  app.get('*', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`LUT Studio server running on port ${PORT}`);
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server Internal Error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});
