import type { VoiceOption } from '../../state/types';

// Voice definition helper
function v(fullValue: string, gender: 'male' | 'female'): VoiceOption {
  const [locale, name] = fullValue.split(', ');
  return { locale, name, fullValue, gender };
}

export const voices: VoiceOption[] = [
  // Russian (prioritized)
  v('ru-RU, DmitryNeural', 'male'),
  v('ru-RU, SvetlanaNeural', 'female'),
  // Multilingual
  v('en-AU, WilliamMultilingualNeural', 'male'),
  v('en-US, AndrewMultilingualNeural', 'male'),
  v('en-US, AvaMultilingualNeural', 'female'),
  v('en-US, BrianMultilingualNeural', 'male'),
  v('en-US, EmmaMultilingualNeural', 'female'),
  v('fr-FR, VivienneMultilingualNeural', 'female'),
  v('fr-FR, RemyMultilingualNeural', 'male'),
  v('de-DE, SeraphinaMultilingualNeural', 'female'),
  v('de-DE, FlorianMultilingualNeural', 'male'),
  v('it-IT, GiuseppeMultilingualNeural', 'male'),
  v('ko-KR, HyunsuMultilingualNeural', 'male'),
  v('pt-BR, ThalitaMultilingualNeural', 'female'),
  // Afrikaans
  v('af-ZA, AdriNeural', 'female'),
  v('af-ZA, WillemNeural', 'male'),
  // Albanian
  v('sq-AL, AnilaNeural', 'female'),
  v('sq-AL, IlirNeural', 'male'),
  // Amharic
  v('am-ET, AmehaNeural', 'male'),
  v('am-ET, MekdesNeural', 'female'),
  // Arabic
  v('ar-DZ, AminaNeural', 'female'),
  v('ar-DZ, IsmaelNeural', 'male'),
  v('ar-BH, AliNeural', 'male'),
  v('ar-BH, LailaNeural', 'female'),
  v('ar-EG, SalmaNeural', 'female'),
  v('ar-EG, ShakirNeural', 'male'),
  v('ar-IQ, BasselNeural', 'male'),
  v('ar-IQ, RanaNeural', 'female'),
  v('ar-JO, SanaNeural', 'female'),
  v('ar-JO, TaimNeural', 'male'),
  v('ar-KW, FahedNeural', 'male'),
  v('ar-KW, NouraNeural', 'female'),
  v('ar-LB, LaylaNeural', 'female'),
  v('ar-LB, RamiNeural', 'male'),
  v('ar-LY, ImanNeural', 'female'),
  v('ar-LY, OmarNeural', 'male'),
  v('ar-MA, JamalNeural', 'male'),
  v('ar-MA, MounaNeural', 'female'),
  v('ar-OM, AbdullahNeural', 'male'),
  v('ar-OM, AyshaNeural', 'female'),
  v('ar-QA, AmalNeural', 'female'),
  v('ar-QA, MoazNeural', 'male'),
  v('ar-SA, HamedNeural', 'male'),
  v('ar-SA, ZariyahNeural', 'female'),
  v('ar-SY, AmanyNeural', 'female'),
  v('ar-SY, LaithNeural', 'male'),
  v('ar-TN, HediNeural', 'male'),
  v('ar-TN, ReemNeural', 'female'),
  v('ar-AE, FatimaNeural', 'female'),
  v('ar-AE, HamdanNeural', 'male'),
  v('ar-YE, MaryamNeural', 'female'),
  v('ar-YE, SalehNeural', 'male'),
  // Azerbaijani
  v('az-AZ, BabekNeural', 'male'),
  v('az-AZ, BanuNeural', 'female'),
  // Bengali
  v('bn-BD, NabanitaNeural', 'female'),
  v('bn-BD, PradeepNeural', 'male'),
  v('bn-IN, BashkarNeural', 'male'),
  v('bn-IN, TanishaaNeural', 'female'),
  // Bosnian
  v('bs-BA, VesnaNeural', 'female'),
  v('bs-BA, GoranNeural', 'male'),
  // Bulgarian
  v('bg-BG, BorislavNeural', 'male'),
  v('bg-BG, KalinaNeural', 'female'),
  // Burmese
  v('my-MM, NilarNeural', 'female'),
  v('my-MM, ThihaNeural', 'male'),
  // Catalan
  v('ca-ES, EnricNeural', 'male'),
  v('ca-ES, JoanaNeural', 'female'),
  // Chinese
  v('zh-HK, HiuGaaiNeural', 'female'),
  v('zh-HK, HiuMaanNeural', 'female'),
  v('zh-HK, WanLungNeural', 'male'),
  v('zh-CN, XiaoxiaoNeural', 'female'),
  v('zh-CN, XiaoyiNeural', 'female'),
  v('zh-CN, YunjianNeural', 'male'),
  v('zh-CN, YunxiNeural', 'male'),
  v('zh-CN, YunxiaNeural', 'male'),
  v('zh-CN, YunyangNeural', 'male'),
  v('zh-CN-liaoning, XiaobeiNeural', 'female'),
  v('zh-TW, HsiaoChenNeural', 'female'),
  v('zh-TW, YunJheNeural', 'male'),
  v('zh-TW, HsiaoYuNeural', 'female'),
  v('zh-CN-shaanxi, XiaoniNeural', 'female'),
  // Croatian
  v('hr-HR, GabrijelaNeural', 'female'),
  v('hr-HR, SreckoNeural', 'male'),
  // Czech
  v('cs-CZ, AntoninNeural', 'male'),
  v('cs-CZ, VlastaNeural', 'female'),
  // Danish
  v('da-DK, ChristelNeural', 'female'),
  v('da-DK, JeppeNeural', 'male'),
  // Dutch
  v('nl-BE, ArnaudNeural', 'male'),
  v('nl-BE, DenaNeural', 'female'),
  v('nl-NL, ColetteNeural', 'female'),
  v('nl-NL, FennaNeural', 'female'),
  v('nl-NL, MaartenNeural', 'male'),
  // English
  v('en-AU, NatashaNeural', 'female'),
  v('en-CA, ClaraNeural', 'female'),
  v('en-CA, LiamNeural', 'male'),
  v('en-HK, YanNeural', 'female'),
  v('en-HK, SamNeural', 'male'),
  v('en-IN, NeerjaExpressiveNeural', 'female'),
  v('en-IN, NeerjaNeural', 'female'),
  v('en-IN, PrabhatNeural', 'male'),
  v('en-IE, ConnorNeural', 'male'),
  v('en-IE, EmilyNeural', 'female'),
  v('en-KE, AsiliaNeural', 'female'),
  v('en-KE, ChilembaNeural', 'male'),
  v('en-NZ, MitchellNeural', 'male'),
  v('en-NZ, MollyNeural', 'female'),
  v('en-NG, AbeoNeural', 'male'),
  v('en-NG, EzinneNeural', 'female'),
  v('en-PH, JamesNeural', 'male'),
  v('en-PH, RosaNeural', 'female'),
  v('en-US, AvaNeural', 'female'),
  v('en-US, AndrewNeural', 'male'),
  v('en-US, EmmaNeural', 'female'),
  v('en-US, BrianNeural', 'male'),
  v('en-SG, LunaNeural', 'female'),
  v('en-SG, WayneNeural', 'male'),
  v('en-ZA, LeahNeural', 'female'),
  v('en-ZA, LukeNeural', 'male'),
  v('en-TZ, ElimuNeural', 'male'),
  v('en-TZ, ImaniNeural', 'female'),
  v('en-GB, LibbyNeural', 'female'),
  v('en-GB, MaisieNeural', 'female'),
  v('en-GB, RyanNeural', 'male'),
  v('en-GB, SoniaNeural', 'female'),
  v('en-GB, ThomasNeural', 'male'),
  v('en-US, AnaNeural', 'female'),
  v('en-US, AriaNeural', 'female'),
  v('en-US, ChristopherNeural', 'male'),
  v('en-US, EricNeural', 'male'),
  v('en-US, GuyNeural', 'male'),
  v('en-US, JennyNeural', 'female'),
  v('en-US, MichelleNeural', 'female'),
  v('en-US, RogerNeural', 'male'),
  v('en-US, SteffanNeural', 'male'),
  // Estonian
  v('et-EE, AnuNeural', 'female'),
  v('et-EE, KertNeural', 'male'),
  // Filipino
  v('fil-PH, AngeloNeural', 'male'),
  v('fil-PH, BlessicaNeural', 'female'),
  // Finnish
  v('fi-FI, HarriNeural', 'male'),
  v('fi-FI, NooraNeural', 'female'),
  // French
  v('fr-BE, CharlineNeural', 'female'),
  v('fr-BE, GerardNeural', 'male'),
  v('fr-CA, ThierryNeural', 'male'),
  v('fr-CA, AntoineNeural', 'male'),
  v('fr-CA, JeanNeural', 'male'),
  v('fr-CA, SylvieNeural', 'female'),
  v('fr-FR, DeniseNeural', 'female'),
  v('fr-FR, EloiseNeural', 'female'),
  v('fr-FR, HenriNeural', 'male'),
  v('fr-CH, ArianeNeural', 'female'),
  v('fr-CH, FabriceNeural', 'male'),
  // Galician
  v('gl-ES, RoiNeural', 'male'),
  v('gl-ES, SabelaNeural', 'female'),
  // Georgian
  v('ka-GE, EkaNeural', 'female'),
  v('ka-GE, GiorgiNeural', 'male'),
  // German
  v('de-AT, IngridNeural', 'female'),
  v('de-AT, JonasNeural', 'male'),
  v('de-DE, AmalaNeural', 'female'),
  v('de-DE, ConradNeural', 'male'),
  v('de-DE, KatjaNeural', 'female'),
  v('de-DE, KillianNeural', 'male'),
  v('de-CH, JanNeural', 'male'),
  v('de-CH, LeniNeural', 'female'),
  // Greek
  v('el-GR, AthinaNeural', 'female'),
  v('el-GR, NestorasNeural', 'male'),
  // Gujarati
  v('gu-IN, DhwaniNeural', 'female'),
  v('gu-IN, NiranjanNeural', 'male'),
  // Hebrew
  v('he-IL, AvriNeural', 'male'),
  v('he-IL, HilaNeural', 'female'),
  // Hindi
  v('hi-IN, MadhurNeural', 'male'),
  v('hi-IN, SwaraNeural', 'female'),
  // Hungarian
  v('hu-HU, NoemiNeural', 'female'),
  v('hu-HU, TamasNeural', 'male'),
  // Icelandic
  v('is-IS, GudrunNeural', 'female'),
  v('is-IS, GunnarNeural', 'male'),
  // Indonesian
  v('id-ID, ArdiNeural', 'male'),
  v('id-ID, GadisNeural', 'female'),
  // Inuktitut
  v('iu-Latn-CA, SiqiniqNeural', 'female'),
  v('iu-Latn-CA, TaqqiqNeural', 'male'),
  v('iu-Cans-CA, SiqiniqNeural', 'female'),
  v('iu-Cans-CA, TaqqiqNeural', 'male'),
  // Irish
  v('ga-IE, ColmNeural', 'male'),
  v('ga-IE, OrlaNeural', 'female'),
  // Italian
  v('it-IT, DiegoNeural', 'male'),
  v('it-IT, ElsaNeural', 'female'),
  v('it-IT, IsabellaNeural', 'female'),
  // Japanese
  v('ja-JP, KeitaNeural', 'male'),
  v('ja-JP, NanamiNeural', 'female'),
  // Javanese
  v('jv-ID, DimasNeural', 'male'),
  v('jv-ID, SitiNeural', 'female'),
  // Kannada
  v('kn-IN, GaganNeural', 'male'),
  v('kn-IN, SapnaNeural', 'female'),
  // Kazakh
  v('kk-KZ, AigulNeural', 'female'),
  v('kk-KZ, DauletNeural', 'male'),
  // Khmer
  v('km-KH, PisethNeural', 'male'),
  v('km-KH, SreymomNeural', 'female'),
  // Korean
  v('ko-KR, InJoonNeural', 'male'),
  v('ko-KR, SunHiNeural', 'female'),
  // Lao
  v('lo-LA, ChanthavongNeural', 'male'),
  v('lo-LA, KeomanyNeural', 'female'),
  // Latvian
  v('lv-LV, EveritaNeural', 'female'),
  v('lv-LV, NilsNeural', 'male'),
  // Lithuanian
  v('lt-LT, LeonasNeural', 'male'),
  v('lt-LT, OnaNeural', 'female'),
  // Macedonian
  v('mk-MK, AleksandarNeural', 'male'),
  v('mk-MK, MarijaNeural', 'female'),
  // Malay
  v('ms-MY, OsmanNeural', 'male'),
  v('ms-MY, YasminNeural', 'female'),
  // Malayalam
  v('ml-IN, MidhunNeural', 'male'),
  v('ml-IN, SobhanaNeural', 'female'),
  // Maltese
  v('mt-MT, GraceNeural', 'female'),
  v('mt-MT, JosephNeural', 'male'),
  // Marathi
  v('mr-IN, AarohiNeural', 'female'),
  v('mr-IN, ManoharNeural', 'male'),
  // Mongolian
  v('mn-MN, BataaNeural', 'male'),
  v('mn-MN, YesuiNeural', 'female'),
  // Nepali
  v('ne-NP, HemkalaNeural', 'female'),
  v('ne-NP, SagarNeural', 'male'),
  // Norwegian
  v('nb-NO, FinnNeural', 'male'),
  v('nb-NO, PernilleNeural', 'female'),
  // Pashto
  v('ps-AF, GulNawazNeural', 'male'),
  v('ps-AF, LatifaNeural', 'female'),
  // Persian
  v('fa-IR, DilaraNeural', 'female'),
  v('fa-IR, FaridNeural', 'male'),
  // Polish
  v('pl-PL, MarekNeural', 'male'),
  v('pl-PL, ZofiaNeural', 'female'),
  // Portuguese
  v('pt-BR, AntonioNeural', 'male'),
  v('pt-BR, FranciscaNeural', 'female'),
  v('pt-PT, DuarteNeural', 'male'),
  v('pt-PT, RaquelNeural', 'female'),
  // Romanian
  v('ro-RO, AlinaNeural', 'female'),
  v('ro-RO, EmilNeural', 'male'),
  // Serbian
  v('sr-RS, NicholasNeural', 'male'),
  v('sr-RS, SophieNeural', 'female'),
  // Sinhala
  v('si-LK, SameeraNeural', 'male'),
  v('si-LK, ThiliniNeural', 'female'),
  // Slovak
  v('sk-SK, LukasNeural', 'male'),
  v('sk-SK, ViktoriaNeural', 'female'),
  // Slovenian
  v('sl-SI, PetraNeural', 'female'),
  v('sl-SI, RokNeural', 'male'),
  // Somali
  v('so-SO, MuuseNeural', 'male'),
  v('so-SO, UbaxNeural', 'female'),
  // Spanish
  v('es-AR, ElenaNeural', 'female'),
  v('es-AR, TomasNeural', 'male'),
  v('es-BO, MarceloNeural', 'male'),
  v('es-BO, SofiaNeural', 'female'),
  v('es-CL, CatalinaNeural', 'female'),
  v('es-CL, LorenzoNeural', 'male'),
  v('es-CO, GonzaloNeural', 'male'),
  v('es-CO, SalomeNeural', 'female'),
  v('es-ES, XimenaNeural', 'female'),
  v('es-CR, JuanNeural', 'male'),
  v('es-CR, MariaNeural', 'female'),
  v('es-CU, BelkysNeural', 'female'),
  v('es-CU, ManuelNeural', 'male'),
  v('es-DO, EmilioNeural', 'male'),
  v('es-DO, RamonaNeural', 'female'),
  v('es-EC, AndreaNeural', 'female'),
  v('es-EC, LuisNeural', 'male'),
  v('es-SV, LorenaNeural', 'female'),
  v('es-SV, RodrigoNeural', 'male'),
  v('es-GQ, JavierNeural', 'male'),
  v('es-GQ, TeresaNeural', 'female'),
  v('es-GT, AndresNeural', 'male'),
  v('es-GT, MartaNeural', 'female'),
  v('es-HN, CarlosNeural', 'male'),
  v('es-HN, KarlaNeural', 'female'),
  v('es-MX, DaliaNeural', 'female'),
  v('es-MX, JorgeNeural', 'male'),
  v('es-NI, FedericoNeural', 'male'),
  v('es-NI, YolandaNeural', 'female'),
  v('es-PA, MargaritaNeural', 'female'),
  v('es-PA, RobertoNeural', 'male'),
  v('es-PY, MarioNeural', 'male'),
  v('es-PY, TaniaNeural', 'female'),
  v('es-PE, AlexNeural', 'male'),
  v('es-PE, CamilaNeural', 'female'),
  v('es-PR, KarinaNeural', 'female'),
  v('es-PR, VictorNeural', 'male'),
  v('es-ES, AlvaroNeural', 'male'),
  v('es-ES, ElviraNeural', 'female'),
  v('es-US, AlonsoNeural', 'male'),
  v('es-US, PalomaNeural', 'female'),
  v('es-UY, MateoNeural', 'male'),
  v('es-UY, ValentinaNeural', 'female'),
  v('es-VE, PaolaNeural', 'female'),
  v('es-VE, SebastianNeural', 'male'),
  // Sundanese
  v('su-ID, JajangNeural', 'male'),
  v('su-ID, TutiNeural', 'female'),
  // Swahili
  v('sw-KE, RafikiNeural', 'male'),
  v('sw-KE, ZuriNeural', 'female'),
  v('sw-TZ, DaudiNeural', 'male'),
  v('sw-TZ, RehemaNeural', 'female'),
  // Swedish
  v('sv-SE, MattiasNeural', 'male'),
  v('sv-SE, SofieNeural', 'female'),
  // Tamil
  v('ta-IN, PallaviNeural', 'female'),
  v('ta-IN, ValluvarNeural', 'male'),
  v('ta-MY, KaniNeural', 'female'),
  v('ta-MY, SuryaNeural', 'male'),
  v('ta-SG, AnbuNeural', 'male'),
  v('ta-SG, VenbaNeural', 'female'),
  v('ta-LK, KumarNeural', 'male'),
  v('ta-LK, SaranyaNeural', 'female'),
  // Telugu
  v('te-IN, MohanNeural', 'male'),
  v('te-IN, ShrutiNeural', 'female'),
  // Thai
  v('th-TH, NiwatNeural', 'male'),
  v('th-TH, PremwadeeNeural', 'female'),
  // Turkish
  v('tr-TR, EmelNeural', 'female'),
  v('tr-TR, AhmetNeural', 'male'),
  // Ukrainian
  v('uk-UA, OstapNeural', 'male'),
  v('uk-UA, PolinaNeural', 'female'),
  // Urdu
  v('ur-IN, GulNeural', 'female'),
  v('ur-IN, SalmanNeural', 'male'),
  v('ur-PK, AsadNeural', 'male'),
  v('ur-PK, UzmaNeural', 'female'),
  // Uzbek
  v('uz-UZ, MadinaNeural', 'female'),
  v('uz-UZ, SardorNeural', 'male'),
  // Vietnamese
  v('vi-VN, HoaiMyNeural', 'female'),
  v('vi-VN, NamMinhNeural', 'male'),
  // Welsh
  v('cy-GB, AledNeural', 'male'),
  v('cy-GB, NiaNeural', 'female'),
  // Zulu
  v('zu-ZA, ThandoNeural', 'female'),
  v('zu-ZA, ThembaNeural', 'male'),
];

export default voices;
