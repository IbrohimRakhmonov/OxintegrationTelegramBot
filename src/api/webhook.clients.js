const express = require('express');
const multer = require('multer');
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/client', upload.any(), (req, res) => {
//   console.log('OX client webhook headers:', req.headers);

  console.log(req.body.body);
//   console.log('OX client webhook files:', req);

  res.status(200).json({ received: true, body: req.body, files: req.files });
});

module.exports = router;