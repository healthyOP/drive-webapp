import express from 'express';
import path from 'path';
import filesRouter from './routes/files.js';
import fs from 'fs/promises';
import { STORAGE_ROOT } from './utils/safePath.js';
import { handleError } from '../utils/errors.js';

// Creates only if storage folder doesn't exist (for example after downloading from GitHub)
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

app.use('/api', (req,res) =>{
    res.status(404).json({error: 'Unknown endpoint'});
})

app.use((err, req, res, next) =>{
    if (res.headersSent) return next(err);
    handleError(err,res);
})

app.listen(port, () => console.log(`server is runing on ${port}`)) ;