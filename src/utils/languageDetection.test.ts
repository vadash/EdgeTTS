import { describe, it, expect } from 'vitest';
import { detectLanguage } from './languageDetection';

describe('languageDetection', () => {
  describe('detectLanguage', () => {
    it('should detect English text', () => {
      const text = 'The quick brown fox jumps over the lazy dog';
      expect(detectLanguage(text).language).toBe('en');
    });

    it('should detect Russian text', () => {
      const text = 'Привет, как дела? Это русский текст.';
      expect(detectLanguage(text).language).toBe('ru');
    });

    it('should detect English when mixed with more Latin characters', () => {
      const text = 'Hello мир! How are you doing today?';
      expect(detectLanguage(text).language).toBe('en');
    });

    it('should detect Russian when mixed with more Cyrillic characters', () => {
      const text = 'Привет world! Как дела today?';
      expect(detectLanguage(text).language).toBe('ru');
    });

    it('should default to English for empty text', () => {
      expect(detectLanguage('').language).toBe('en');
      expect(detectLanguage('   ').language).toBe('en');
    });

    it('should handle text with only punctuation', () => {
      const text = '!@#$%^&*()_+{}[]|:;<>,.?/~`';
      expect(detectLanguage(text).language).toBe('en');
    });

    it('should handle text with numbers', () => {
      const text = '1234567890';
      expect(detectLanguage(text).language).toBe('en');
    });

    it('should detect English in typical book content', () => {
      const text = `Chapter 1: The Beginning

      Once upon a time, in a land far away, there lived a young programmer who loved to code.
      They spent their days writing tests and building amazing applications.`;
      expect(detectLanguage(text).language).toBe('en');
    });

    it('should detect Russian in typical book content', () => {
      const text = `Глава 1: Начало

      Давным-давно, в далекой стране, жил молодой программист, который любил писать код.
      Он проводил дни, создавая тесты и разрабатывая удивительные приложения.`;
      expect(detectLanguage(text).language).toBe('ru');
    });

    it('should detect German text', () => {
      const text = 'Der Mann ging mit seinem Hund in den Park und die Kinder spielten auf der Wiese.';
      expect(detectLanguage(text).language).toBe('de');
    });

    it('should detect Japanese text (Hiragana/Katakana)', () => {
      const text = 'むかしむかし、あるところにおじいさんとおばあさんがいました。';
      expect(detectLanguage(text).language).toBe('ja');
    });

    it('should detect Korean text (Hangul)', () => {
      const text = '옛날 옛적에 한 마을에 착한 소년이 살고 있었습니다.';
      expect(detectLanguage(text).language).toBe('ko');
    });

    it('should detect Chinese text (CJK)', () => {
      const text = '从前有一个小村庄，村庄里住着一位老人和他的孙子。';
      expect(detectLanguage(text).language).toBe('zh');
    });

    it('should detect Thai text', () => {
      const text = 'กาลครั้งหนึ่งนานมาแล้ว มีชายหนุ่มคนหนึ่งอาศัยอยู่ในหมู่บ้านเล็กๆ';
      expect(detectLanguage(text).language).toBe('th');
    });

    it('should detect Greek text', () => {
      const text = 'Μια φορά και έναν καιρό ζούσε ένας νεαρός σε ένα μικρό χωριό.';
      expect(detectLanguage(text).language).toBe('el');
    });

    it('should detect Hebrew text', () => {
      const text = 'פעם היה ילד קטן שגר בכפר קטן ליד הים הגדול.';
      expect(detectLanguage(text).language).toBe('he');
    });

    it('should detect Georgian text', () => {
      const text = 'იყო და არა იყო რა, იყო ერთი პატარა სოფელი მთებში.';
      expect(detectLanguage(text).language).toBe('ka');
    });

    it('should detect Bengali text', () => {
      const text = 'একসময় এক ছোট্ট গ্রামে এক বৃদ্ধ লোক বাস করত।';
      expect(detectLanguage(text).language).toBe('bn');
    });

    it('should detect Tamil text', () => {
      const text = 'ஒரு காலத்தில் ஒரு சிறிய கிராமத்தில் ஒரு முதியவர் வாழ்ந்தார்.';
      expect(detectLanguage(text).language).toBe('ta');
    });

    it('should return high confidence for unique-script languages', () => {
      const text = 'むかしむかし、あるところにおじいさんとおばあさんがいました。';
      expect(detectLanguage(text).confidence).toBe('high');
      expect(detectLanguage(text).method).toBe('script');
    });

    it('should detect German text', () => {
      const text = 'Der Mann ging mit seinem Hund in den Park und die Kinder spielten auf der Wiese. Er hatte einen langen Tag hinter sich und wollte sich ausruhen.';
      expect(detectLanguage(text).language).toBe('de');
    });

    it('should detect French text', () => {
      const text = "L'homme est allé dans le parc avec son chien et les enfants jouaient sur la pelouse. Il avait eu une longue journée et voulait se reposer.";
      expect(detectLanguage(text).language).toBe('fr');
    });

    it('should detect Spanish text', () => {
      const text = 'El hombre fue al parque con su perro y los niños jugaban en el césped. Había tenido un largo día y quería descansar.';
      expect(detectLanguage(text).language).toBe('es');
    });

    it('should detect Italian text', () => {
      const text = "L'uomo è andato al parco con il suo cane e i bambini giocavano sul prato. Aveva avuto una lunga giornata e voleva riposarsi.";
      expect(detectLanguage(text).language).toBe('it');
    });

    it('should detect Portuguese text', () => {
      const text = 'O homem foi ao parque com o seu cão e as crianças brincavam na relva. Ele tinha tido um longo dia e queria descansar.';
      expect(detectLanguage(text).language).toBe('pt');
    });

    it('should detect Dutch text', () => {
      const text = 'De man ging naar het park met zijn hond en de kinderen speelden op het gras. Hij had een lange dag gehad en wilde uitrusten.';
      expect(detectLanguage(text).language).toBe('nl');
    });

    it('should detect Polish text', () => {
      const text = 'Mężczyzna poszedł do parku ze swoim psem a dzieci bawiły się na trawniku. Miał za sobą długi dzień i chciał odpocząć.';
      expect(detectLanguage(text).language).toBe('pl');
    });

    it('should detect Turkish text', () => {
      const text = 'Adam köpeğiyle birlikte parka gitti ve çocuklar çimlerde oynuyorlardı. Uzun bir günün ardından dinlenmek istiyordu.';
      expect(detectLanguage(text).language).toBe('tr');
    });

    it('should detect Czech text', () => {
      const text = 'Muž šel do parku se svým psem a děti si hrály na trávníku. Měl za sebou dlouhý den a chtěl si odpočinout.';
      expect(detectLanguage(text).language).toBe('cs');
    });

    it('should detect Swedish text', () => {
      const text = 'Mannen gick till parken med sin hund och barnen lekte på gräsmattan. Han hade haft en lång dag och ville vila sig.';
      expect(detectLanguage(text).language).toBe('sv');
    });

    it('should detect Indonesian text', () => {
      const text = 'Pria itu pergi ke taman dengan anjingnya dan anak-anak bermain di rumput. Dia sudah memiliki hari yang panjang dan ingin beristirahat.';
      expect(detectLanguage(text).language).toBe('id');
    });

    it('should return medium confidence for stopword-detected languages', () => {
      const text = 'Der Mann ging mit seinem Hund in den Park und die Kinder spielten auf der Wiese.';
      const result = detectLanguage(text);
      expect(result.confidence).toBe('medium');
      expect(result.method).toBe('stopwords');
    });

    it('should detect Ukrainian text (Cyrillic disambiguation)', () => {
      const text = 'Чоловік пішов у парк зі своїм собакою і діти грали на газоні. Він мав довгий день і хотів відпочити. Це було дуже гарно.';
      expect(detectLanguage(text).language).toBe('uk');
    });

    it('should detect Bulgarian text (Cyrillic disambiguation)', () => {
      const text = 'Мъжът отиде в парка с кучето си и децата играеха на тревата. Той имаше дълъг ден и искаше да си почине. Това беше много хубаво.';
      expect(detectLanguage(text).language).toBe('bg');
    });

    it('should detect Persian/Farsi text (Arabic script disambiguation)', () => {
      const text = 'مرد با سگش به پارک رفت و بچه ها روی چمن بازی می کردند. او یک روز طولانی داشت و می خواست استراحت کند.';
      expect(detectLanguage(text).language).toBe('fa');
    });

    it('should detect Hindi text (Devanagari disambiguation)', () => {
      const text = 'आदमी अपने कुत्ते के साथ पार्क में गया और बच्चे घास पर खेल रहे थे। उसका एक लंबा दिन था और वह आराम करना चाहता था।';
      expect(detectLanguage(text).language).toBe('hi');
    });
  });
});
