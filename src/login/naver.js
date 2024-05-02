const express = require('express');
const router = express.Router();
const axios = require('axios');
const cookieParser = require('cookie-parser'); // 쿠키 파서 미들웨어 추가
const session = require('express-session'); // 세션 미들웨어 추가

const { User } = require('../user/user_schema');

const dotenv = require("dotenv"); 
require('dotenv').config();

router.get('/', async(req, res) => {
  const oauthUrl = `https://nid.naver.com/oauth2.0/authorize?response_type=code&client_id=${process.env.NAVER_ID}&redirect_uri=${process.env.NAVER_URI}&state=abcde12345`;
  res.redirect(oauthUrl);
});

// 콜백 처리
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  
  // 인증 코드를 사용하여 액세스 토큰 요청
  const tokenUrl = 'https://nid.naver.com/oauth2.0/token';
  const params = {
    grant_type: 'authorization_code',
    client_id: process.env.NAVER_ID,
    client_secret: process.env.NAVER_SECRET,
    code: code,
    state: state
  };
  
  try {
    const tokenResponse = await axios.post(tokenUrl, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    
    // 액세스 토큰 받아옴
    const accessToken = tokenResponse.data.access_token;
    
    try {
      const naveruser = await axios.get("https://openapi.naver.com/v1/nid/me", {
        headers: {
          "Authorization" : `Bearer ${accessToken}`
        }
      });

      // 사용자 정보를 naveruser 변수에 할당
      const naveruserData = naveruser.data.response;

      // 데이터베이스에서 사용자 정보 조회
      let user = await User.findOne({ oauthId: naveruserData.id });

      // 새로운 사용자인지 확인하고 세션 및 쿠키 생성
      if (!user) {
        user = new User({
          oauthId: naveruserData.id,
          name: naveruserData.name,
          email: naveruserData.email
          // 다른 사용자 정보 필드 추가 가능
        });

        await user.save(); // 새로운 사용자 정보 저장

        req.session.userId = user._id; 
        res.cookie('userSession', JSON.stringify(req.session), { maxAge: 86400 * 1000 }); // 세션에 쿠키 저장, 유효기간 1일

        res.json({ message: '회원가입 성공', email: naveruserData.email });
      } else {
        // 기존 사용자인 경우 로그인 메시지 응답
        req.session.userId = user._id; 
        res.cookie('userSession', JSON.stringify(req.session), { maxAge: 86400 * 1000 }); // 세션에 쿠키 저장, 유효기간 1일

        res.json({ message: '로그인 성공', email: naveruserData.email });
      }

    } catch (error) {
      console.error('로그인 실패:', error);
      res.status(500).send('로그인 실패');
    }

  } catch (error) {
    console.error('인증 실패:', error);
    res.status(500).send('인증 실패');
  }
});

module.exports = router;