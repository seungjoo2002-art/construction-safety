// ============================================================
// status-labels.js — 모델/백엔드 category 값의 "표시용" 다국어 매핑
// ------------------------------------------------------------
// ⚠️ 절대 이 값들을 API 요청 payload나 내부 비교 로직에 쓰지 마세요.
// 여기 있는 한국어 키(예: "추락·압착(Falls)", "매우위험")는 Backend/config.py의
// RISK_GRADES / TYPE_LIKELIHOOD_GRADES / TYPE_NAMES, similarity_service.py의
// _map_incident_to_sif() 결과와 "글자 하나까지" 정확히 일치해야 합니다 — 이 값이
// 바뀌면 여기 매핑도 같이 바꿔야 하지만, 반대로 이 파일을 고친다고 백엔드로 보내는
// 값이 바뀌면 절대 안 됩니다(항상 원래 한국어 키 그대로 전송). 화면에 "보여줄 때만"
// i18n.js의 tStatus(koreanValue)를 통해 조회하세요.
// ============================================================
window.STATUS_LABEL_MAP = {
  // ── 위험도 등급 (Backend/config.py RISK_GRADES)
  "매우위험": { en: "Very High Risk", zh: "极高风险", vi: "Rủi ro rất cao", th: "ความเสี่ยงสูงมาก", id: "Risiko Sangat Tinggi", ne: "अति उच्च जोखिम" },
  "위험":     { en: "High Risk",      zh: "高风险",   vi: "Rủi ro cao",     th: "ความเสี่ยงสูง",     id: "Risiko Tinggi",      ne: "उच्च जोखिम" },
  "주의":     { en: "Caution",        zh: "需注意",   vi: "Cần chú ý",      th: "ควรระวัง",           id: "Perlu Perhatian",    ne: "सावधानी" },
  "보통":     { en: "Moderate",       zh: "中等",     vi: "Trung bình",     th: "ปานกลาง",           id: "Sedang",             ne: "मध्यम" },
  "낮음":     { en: "Low",            zh: "较低",     vi: "Thấp",           th: "ต่ำ",                id: "Rendah",             ne: "कम" },

  // ── 사고유형 발생가능성 등급 (Backend/config.py TYPE_LIKELIHOOD_GRADES)
  "매우높음": { en: "Very High", zh: "非常高", vi: "Rất cao", th: "สูงมาก", id: "Sangat Tinggi", ne: "धेरै उच्च" },
  "높음":     { en: "High",      zh: "较高",   vi: "Cao",     th: "สูง",     id: "Tinggi",        ne: "उच्च" },

  // ── 부상 심각도 3분류 (predicted_class)
  "치명":        { en: "Fatal",              zh: "致命",       vi: "Tử vong",         th: "เสียชีวิต",         id: "Fatal",            ne: "घातक" },
  "중상":        { en: "Serious Injury",     zh: "重伤",       vi: "Chấn thương nặng", th: "บาดเจ็บสาหัส",     id: "Cedera Serius",   ne: "गम्भीर चोट" },
  "경+중등도":   { en: "Minor/Moderate",     zh: "轻度/中度",  vi: "Nhẹ/Trung bình",  th: "เล็กน้อย/ปานกลาง", id: "Ringan/Sedang",   ne: "सामान्य/मध्यम" },

  // ── 사고유형 5분류 (Backend/config.py TYPE_NAMES)
  "끼임(Caught-in)":                          { en: "Caught-in", zh: "夹伤/卡住", vi: "Kẹt/Cuốn vào máy", th: "ติดหนีบ/ถูกดึงเข้าเครื่องจักร", id: "Terjepit", ne: "च्यापिने/फस्ने" },
  "절단·베임·찔림(Cut)":                       { en: "Cut/Laceration/Puncture", zh: "切割/割伤/刺伤", th: "บาด/ตัด/แทง", vi: "Đứt/Cắt/Đâm", id: "Terpotong/Tersayat/Tertusuk", ne: "काटिने/घोचिने" },
  "추락·압착(Falls)":                          { en: "Fall/Crush", zh: "坠落/挤压", vi: "Ngã/Đè ép", th: "ตกจากที่สูง/ถูกกดทับ", id: "Jatuh/Terhimpit", ne: "लड्ने/थिचिने" },
  "물체에 맞음(Struck-by)":                    { en: "Struck-by Object", zh: "物体打击", vi: "Bị vật rơi trúng", th: "ถูกวัตถุกระแทก", id: "Tertimpa Benda", ne: "वस्तुले हिर्काउने" },
  "전도·충돌(Trips/Struck-against)":           { en: "Trip/Collision", zh: "跌倒/碰撞", vi: "Trượt ngã/Va chạm", th: "สะดุดล้ม/ชนกระแทก", id: "Tersandung/Tertabrak", ne: "लड्खडाइने/ठोकिने" },

  // ── 유사도 서비스(similarity_service.py) hazard_type 9종
  "추락": { en: "Fall",      zh: "坠落", vi: "Ngã",           th: "ตกจากที่สูง", id: "Jatuh",       ne: "लड्ने" },
  "낙하": { en: "Falling Object", zh: "落物", vi: "Vật rơi", th: "วัตถุตกใส่", id: "Benda Jatuh", ne: "खस्ने वस्तु" },
  "전도": { en: "Trip/Fall Over", zh: "跌倒", vi: "Trượt ngã", th: "หกล้ม", id: "Terjatuh",    ne: "लड्खडाइने" },
  "부딪힘": { en: "Collision", zh: "碰撞", vi: "Va chạm",     th: "ชนกระแทก",   id: "Tertabrak",   ne: "ठोकिने" },
  "끼임": { en: "Caught-in", zh: "夹伤/卡住", vi: "Kẹt",       th: "ติดหนีบ",     id: "Terjepit",    ne: "च्यापिने" },
  "깔림": { en: "Crushed Under", zh: "压伤", vi: "Bị đè",     th: "ถูกทับ",     id: "Tertindih",   ne: "थिचिने" },
  "베임": { en: "Laceration", zh: "割伤", vi: "Bị cắt",      th: "ถูกบาด",     id: "Tersayat",    ne: "घोचिने" },
  "찔림": { en: "Puncture",   zh: "刺伤", vi: "Bị đâm",      th: "ถูกแทง",     id: "Tertusuk",    ne: "घोचिने" },
  "기타": { en: "Other",      zh: "其他", vi: "Khác",         th: "อื่นๆ",       id: "Lainnya",     ne: "अन्य" },

  // ── 공공/민간 구분 (site-setup)
  "공공": { en: "Public",  zh: "公共", vi: "Công cộng", th: "ภาครัฐ",   id: "Publik",  ne: "सार्वजनिक" },
  "민간": { en: "Private", zh: "民营", vi: "Tư nhân",   th: "ภาคเอกชน", id: "Swasta",  ne: "निजी" },
};
