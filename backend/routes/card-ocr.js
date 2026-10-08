const express = require('express');
const multer = require('multer');
const { asyncRoute, httpError } = require('../lib/errors');
const { requireEmployee } = require('../lib/access');
const { recognizeBusinessCard } = require('../lib/tencentOcr');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

router.post('/holder/recognize', upload.single('photo'), asyncRoute(async (req, res) => {
  requireEmployee(req);
  if (!req.file) throw httpError(400, 'VALIDATION_ERROR', '请上传名片照片');
  const draft = await recognizeBusinessCard(req.file.buffer);
  res.json({ draft });
}));

module.exports = router;
