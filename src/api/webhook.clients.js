const express = require('express');
const multer = require('multer');
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/client', upload.any(), (req, res) => {
  // Сразу отвечаем OX, иначе он считает доставку неудачной и повторяет запрос
  res.status(200).json({ received: true });

  try {
    console.log('Content-Type:', req.headers['content-type']);
    console.log('Поля формы (req.body):', req.body);
    console.log('Имена полей:', Object.keys(req.body || {}));
    console.log('Файлы:', (req.files || []).map(f => ({
      field: f.fieldname,
      name: f.originalname,
      type: f.mimetype,
      size: f.size,
      preview: f.buffer.toString('utf8').slice(0, 500),
    })));
    const data = JSON.parse(JSON.stringify(req.body));
    console.log(data);
  } catch (error) {
    console.log(error);
  }
});

module.exports = router;