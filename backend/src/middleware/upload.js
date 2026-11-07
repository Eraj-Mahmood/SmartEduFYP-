const multer = require("multer");

// One .csv file in the "file" field, at most 2 MB, kept in memory (never written to disk).
const MAX_BYTES = 2 * 1024 * 1024;

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (/\.csv$/i.test(file.originalname || "")) return cb(null, true);
    const e = new Error("Only .csv files can be uploaded");
    e.status = 400;
    cb(e);
  },
}).single("file");

/** Express middleware: parses the upload and turns multer errors into 400 {error}. */
function singleCsv(req, res, next) {
  csvUpload(req, res, (err) => {
    if (!err) {
      if (!req.file) return res.status(400).json({ error: "Attach a .csv file in the 'file' field" });
      return next();
    }
    if (err instanceof multer.MulterError) {
      const msg = err.code === "LIMIT_FILE_SIZE" ? "The file is larger than 2 MB" : `Upload problem: ${err.message}`;
      return res.status(400).json({ error: msg });
    }
    return res.status(err.status || 400).json({ error: err.message });
  });
}

module.exports = { singleCsv, MAX_BYTES };
