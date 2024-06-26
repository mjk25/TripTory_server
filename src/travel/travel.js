const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const cors = require('cors');

const { Storage } = require('@google-cloud/storage');
const multer = require('multer');

const { User } = require('../user/user_schema');
const { Travel } = require('./travel_schema');

const corsOptions = {
  origin: process.env.FRONT_URL, // 허용할 출처
  credentials: true // 인증 정보 허용
};

router.use(cors(corsOptions));


// Google Cloud Storage 설정
const storage = new Storage({
  projectId: process.env.GCP_PROJECT_ID, // GCP 프로젝트 ID
  keyFilename: process.env.STORAGE_KEYFILE // 서비스 계정 키 파일 경로
});
const bucketName = process.env.STORAGE_BUCKET_NAME; // GCS 버킷 이름
const bucket = storage.bucket(bucketName);

// Multer 설정
const multerStorage = multer.memoryStorage();
const upload = multer({ storage: multerStorage });

// 사용자가 이미 초대된 상태인지 확인하는 함수
const isUserAlreadyInvited = (invitedArray, userId) => {
  return invitedArray.some(invited => invited.user.equals(userId));
};

async function getSignedUrl(travel, res) {
  const options = {
    version: 'v4',
    action: 'read',
    expires: Date.now() + 60 * 1000, // 1분 동안 유효
  };

  try {
    const [travelurl] = await bucket.file(`travel/${travel._id}`).getSignedUrl(options);
    return travelurl;
    
  } catch (err) {
      console.error('이미지 URL 생성 실패:', err);
      return res.status(500).json({ success: false, message: '이미지 URL 생성 실패' });
  } 
}

//user profile img 받아오기
async function getSignedUrl_user(userId) {
  const options = {
    version: 'v4',
    action: 'read',
    expires: Date.now() + 60 * 1000, // 1분 동안 유효
  };

  try {
    const [profileurl] = await bucket.file(`user/${userId}`).getSignedUrl(options);
    return profileurl;
  } catch (err) {
      console.error('프로필 URL 생성 실패:', err);
      return res.status(500).json({ success: false, message: '프로필 URL 생성 실패' });
  } 
};

router.get('/', async (req, res) => {
  console.log("여행 목록 요청");
  try {
    if (req.session && req.session.userId) {
      const travels = await Travel.find({ 'invited.user': req.session.userId });
      
      if (travels.length > 0) { // 여행 목록이 비어있지 않은지 확인
        const travelUrls = [];
        for (const travel of travels) {
          travelurl = await getSignedUrl(travel, res);
          travelUrls.push(travelurl);
        }
        return res.status(200).json({ success: true, travels, travelUrls });

      } else {
        console.log('해당 사용자의 여행 목록을 찾을 수 없습니다.');
        return res.status(404).json({ success: false, message: '해당 사용자의 여행 목록을 찾을 수 없습니다.' });
      }
    } else {
      console.log('로그인이 필요합니다.');
      return res.status(401).json ({ success: false, message: '로그인이 필요합니다.' });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: '서버 오류' });
  }
});

router.get('/:travelid', async (req, res) => {
  console.log("특정 여행 조회 요청");
  try {
    const travel = await Travel.findById(req.params.travelid);
    if (travel) { // 특정 여행을 찾았는지 확인
      travelurl = await getSignedUrl(travel, res);  // 여행 대표이미지 url
      
      let invited_profile =[];  // 여행 초대된 사람들 프로필사진

      // 사용자 프로필 이미지 얻기
      const usersWithProfileImg = await Promise.all(travel.invited.map(async invited => {
        profileurl = await getSignedUrl_user(invited.user);
        invited_profile.push({user: invited.user, url: profileurl});

      }));
      console.log("invited_profile: ", invited_profile);      

      return res.status(200).json({ // 특정 여행 정보 + 대표사진 + 유저 프로필(id + 사진url)
        success: true,
        travel, 
        travelurl,  
        invited_profile
      });
    } else {
      console.log('해당 여행을 찾을 수 없습니다.');
      return res.status(404).json({ success: false, message: '해당 여행을 찾을 수 없습니다.' });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: '서버 오류' });
  }
});


router.post('/', upload.single('image'),async (req, res) => {
  console.log("여행 생성 요청");
  try {
    if(req.session && req.session.userId){
      const user = await User.findById(req.session.userId);
      if (user) {
        console.log('사용자 ID:', user._id);
  
        // invite token 생성
        let ivtoken;         
        while(true) {
          ivtoken = crypto.randomBytes(8).toString('hex'); // 16바이트의 랜덤 토큰 생성
          const unique = await Travel.find({ ivtoken: ivtoken });
          if(!unique.length)
            break;
        }

        // 새 여행
        const travel = new Travel({
          title: req.body.title,
          startdate: req.body.startdate,
          enddate: req.body.enddate,
          location: req.body.location,
          travelimg: null, // 이미지 경로 저장
          invited: [{ user: user._id, name: user.name }], // 초대된 사용자 배열에 현재 사용자 추가
          ivtoken: ivtoken // 새 사용자 이름 추가
        });
        //travel.userName = user.name;

        // 여행 대표 이미지 업로드
        if (req.file) {
          try {
            const TravelImgFile = req.file;
            const imageName = travel._id.toString();
            const file = bucket.file(`travel/${imageName}`);

            // GCS에 이미지 업로드
            await file.save(TravelImgFile.buffer, { contentType: TravelImgFile.mimetype });

            // MongoDB에 이미지 이름 저장
            travel.travelimg = imageName; // TravelImgPath(URL) => imageName(_id)
            console.log('여행 대표 사진 업로드 성공');

          } catch (error) {
            console.error(error);
            return res.status(500).json({ success: false, message: '여행 대표 사진 업로드에 실패했습니다.' });
          }
        }
       
        const savedTravel = await travel.save(); // 여행 객체 저장
        
        return res.status(200).json({
          success: true,
          travelInfo: savedTravel,
        });
      } else {
        console.log('사용자를 찾을 수 없습니다.');
        return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
      }
    } else {
      console.log('로그인이 필요합니다.');
      return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: '서버 오류' });
  }
});

router.post('/invite', async (req, res) => {
  console.log("여행 초대 요청");
  try {
    if (req.session && req.session.userId){

      const { ivtoken } = req.body;
      if (!ivtoken) {
        return res.status(400).json({ success: false, message: 'ivtoken이 필요합니다.' });
      }

      const user = await User.findById(req.session.userId);
      const travel = await Travel.findOne({ ivtoken: req.body.ivtoken });      
      if (travel){
        console.log('여행 ID:', travel._id);
        if(user){
          console.log('초대할 사용자 ID:', user._id);
  
          if (isUserAlreadyInvited(travel.invited, user._id)) {
            console.log('이미 초대된 사용자입니다.');
            return res.status(400).json({ success: false, message: '이미 초대된 사용자입니다.' });
          } 

          return res.status(200).json({ success: true, travelid: travel._id, auth: travel.invited[0].name });
        } 
      } else {
        console.log('일차하는 여행을 찾을 수 없습니다.');
        return res.status(404).json({ success: false, message: '일치하는 여행을 찾을 수 없습니다.'});
      }     
    } else {
      console.log('로그인이 필요합니다.');
      return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });  
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: '서버 오류' });
  }
});

router.put('/invite', async (req, res) => {
  console.log("여행 초대 수락");
  try {
    if (req.session && req.session.userId){
      const user = await User.findById(req.session.userId);
      const travel = await Travel.findById(req.body.travelid); // 여행 토큰으로 여행을 검색
      if (travel) {
        console.log('여행 ID:', travel._id);
        if (user) {
          console.log('초대할 사용자 ID:', user._id);

          travel.invited.push({user: user._id, name: user.name}); // 초대된 사용자 배열에 추가
          
          await travel.save(); // 여행 객체 저장
  
          console.log('사용자 초대 완료');
          return res.status(200).json({ success: true, message: '사용자 초대 완료' });
        } else {
          console.log('초대할 사용자를 찾을 수 없습니다.');
          return res.status(404).json({ success: false, message: '초대할 사용자를 찾을 수 없습니다.' });
        }
      } else {
        console.log('일차하는 여행을 찾을 수 없습니다.');
        return res.status(404).json({ success: false, message: '일치하는 여행을 찾을 수 없습니다.'});
      }
    } else {
      console.log('로그인이 필요합니다.');
      return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });  
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: '서버 오류' });
  }
});

router.put('/:travelid', upload.single('image'), async (req, res) => {
  console.log('여행 수정 요청');
  try {
    if (req.session && req.session.userId){
      const travel = await Travel.findById(req.params.travelid);
      if(travel){
        console.log('수정할 여행 ID:', travel._id);
  
        const user = await User.findById(req.session.userId);
        if (!travel.invited.user.includes(user._id)) {
          console.log('여행에 대한 권한이 없습니다.');
          return res.status(403).json({ success: false, message: '여행에 대한 권한이 없습니다.' });
        }

        // 여행 대표 이미지 업로드 
        if (req.file) {
          try {
          const TravelImgFile = req.file;
          const imageName = travel._id.toString(); // 클라이언트에서 전송한 이미지 이름을 추출합니다.
          const file = bucket.file(`travel/${imageName}`);    

          // GCS에 이미지 업로드
          await file.save(TravelImgFile.buffer, { contentType: TravelImgFile.mimetype });

          // MongoDB에 이미지 이름 저장
          travel.travelimg = imageName;
          await travel.save();  

          console.log('여행 대표 사진 변경 성공');
          } catch (error) {
          console.error(error);
          res.status(500).json({ success: false, message: '여행 대표 사진 변경에 실패했습니다.' });
          }
        }
  
        await Travel.findByIdAndUpdate(req.params.travelid, {
          title: req.body.title,
          startdate: req.body.startdate,
          enddate: req.body.enddate,
          travelimg: imageName, // MongoDB에 이미지 이름 저장
        }, {new: true} );

        if(req.body.location){
          travel.location = { ...travel.location, ...req.body.location };
          await travel.save();
        }
        
        console.log('여행 수정 완료');
        return res.status(200).json({ success: true, travel });
  
      } else {
        console.log('해당 여행을 찾을 수 없습니다.');
        return res.status(404).json({ success : false, message : '해당 여행을 찾을 수 없습니다.' });
      }
    } else {
      console.log('로그인이 필요합니다.');
      return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: '서버 오류' });
  }
});

router.delete('/:travelid', async (req, res) => {
  console.log('여행 삭제 요청');
  try{
    if (req.session && req.session.userId){
      const travel = await Travel.findById(req.params.travelid);

      if(travel){
        console.log('삭제할 여행 ID:', travel._id);

        const user = await User.findById(req.session.userId);
        if (!travel.invited.includes(user._id)) {
          console.log('여행에 대한 권한이 없습니다.');
          return res.status(403).json({ success: false, message: '여행에 대한 권한이 없습니다.' });
        }

        travel.invited = travel.invited.filter(userId => userId.toString() !== user._id.toString());
        console.log(travel.invited);
        await travel.save();
      
        if (travel.invited.length === 0) {
          // MongoDB에서 삭제
          await Travel.findByIdAndDelete(travel._id);
        }

        // Storage에서 삭제
        const [files] = await storage.bucket(bucketName).getFiles({
          prefix: `travel/${travel._id}`,
        });
        await Promise.all(files.map(file => file.delete()));
      
        console.log('여행 삭제 완료');
        return res.status(200).json({ success: true, message: '여행 삭제 완료'});

      } else {
        console.log('해당 여행을 찾을 수 없습니다.');
        return res.status(404).json({ success : false, message : '해당 여행을 찾을 수 없습니다.' });
      }
    } else {
      console.log('로그인이 필요합니다.');
      return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
    }
  } catch(err) {
    console.error(err);
    return res.status(500).json({ success : false, message : '서버 오류' });
  }
})


module.exports = router;
