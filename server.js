import express from 'express';
import path from 'path';
import filesRouter from './routes/files.js';
import fs from 'fs/promises';
import { STORAGE_ROOT } from './utils/safePath.js';

await fs.mkdir(STORAGE_ROOT, { recursive: true });

const port = process.env.PORT || 3000;
const app = express();

// middleware
app.use(express.json());

// setup static folder
const __dirname = import.meta.dirname;
app.use(express.static(path.join(__dirname, 'public')));


// Routes
app.use('/api', filesRouter);

app.listen(port, () => console.log(`server is runing on ${port}`)) ;