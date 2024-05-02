const express = require('express');
const router = express.Router();


// oauth 라우터 추가
const naverAPI = require('./login/naver');
router.use('/naver', naverAPI);

const googleAPI = require('./login/google');
router.use('/google', googleAPI);


module.exports = router;