/**
 * Gender inference from character names for Russian and English
 */

// Common Russian male names
const RUSSIAN_MALE_NAMES = new Set([
  'Александр', 'Алексей', 'Анатолий', 'Андрей', 'Антон', 'Аркадий', 'Артём', 'Артем',
  'Борис', 'Вадим', 'Валентин', 'Валерий', 'Василий', 'Виктор', 'Виталий', 'Владимир',
  'Владислав', 'Вячеслав', 'Геннадий', 'Георгий', 'Григорий', 'Даниил', 'Денис', 'Дмитрий',
  'Евгений', 'Егор', 'Иван', 'Игорь', 'Илья', 'Кирилл', 'Константин', 'Лев', 'Леонид',
  'Максим', 'Михаил', 'Никита', 'Николай', 'Олег', 'Павел', 'Пётр', 'Петр', 'Роман',
  'Руслан', 'Сергей', 'Станислав', 'Степан', 'Тимофей', 'Фёдор', 'Федор', 'Филипп',
  'Эдуард', 'Юрий', 'Яков', 'Ярослав',
]);

// Common Russian female names
const RUSSIAN_FEMALE_NAMES = new Set([
  'Александра', 'Алина', 'Алиса', 'Алла', 'Анастасия', 'Анна', 'Антонина', 'Валентина',
  'Валерия', 'Вера', 'Вероника', 'Виктория', 'Галина', 'Дарья', 'Диана', 'Ева', 'Евгения',
  'Екатерина', 'Елена', 'Елизавета', 'Жанна', 'Зинаида', 'Зоя', 'Инна', 'Ирина', 'Карина',
  'Кира', 'Ксения', 'Лариса', 'Лидия', 'Любовь', 'Людмила', 'Маргарита', 'Марина', 'Мария',
  'Надежда', 'Наталья', 'Нина', 'Оксана', 'Ольга', 'Полина', 'Раиса', 'Светлана', 'София',
  'Софья', 'Тамара', 'Татьяна', 'Ульяна', 'Юлия', 'Яна',
]);

// Common English male names
const ENGLISH_MALE_NAMES = new Set([
  'Adam', 'Adrian', 'Alan', 'Albert', 'Alex', 'Alexander', 'Andrew', 'Anthony', 'Arthur',
  'Ben', 'Benjamin', 'Bill', 'Bob', 'Brad', 'Brandon', 'Brian', 'Bruce', 'Carl', 'Carlos',
  'Charles', 'Chris', 'Christopher', 'Daniel', 'David', 'Dennis', 'Derek', 'Donald', 'Douglas',
  'Edward', 'Eric', 'Eugene', 'Frank', 'Fred', 'Gary', 'George', 'Gerald', 'Gregory', 'Harold',
  'Harry', 'Henry', 'Howard', 'Jack', 'Jacob', 'James', 'Jason', 'Jeff', 'Jeffrey', 'Jeremy',
  'Jerry', 'Jim', 'Joe', 'John', 'Jonathan', 'Joseph', 'Joshua', 'Justin', 'Keith', 'Kenneth',
  'Kevin', 'Larry', 'Lawrence', 'Leonard', 'Louis', 'Mark', 'Martin', 'Matthew', 'Michael',
  'Nathan', 'Nicholas', 'Patrick', 'Paul', 'Peter', 'Philip', 'Ralph', 'Raymond', 'Richard',
  'Robert', 'Roger', 'Ronald', 'Roy', 'Russell', 'Ryan', 'Samuel', 'Scott', 'Sean', 'Stephen',
  'Steve', 'Steven', 'Thomas', 'Timothy', 'Tom', 'Victor', 'Walter', 'Wayne', 'William',
]);

// Common English female names
const ENGLISH_FEMALE_NAMES = new Set([
  'Alice', 'Amanda', 'Amber', 'Amy', 'Andrea', 'Angela', 'Ann', 'Anna', 'Anne', 'Ashley',
  'Barbara', 'Betty', 'Beverly', 'Brenda', 'Brittany', 'Carol', 'Caroline', 'Catherine',
  'Charlotte', 'Cheryl', 'Christina', 'Christine', 'Cynthia', 'Danielle', 'Deborah', 'Denise',
  'Diana', 'Diane', 'Donna', 'Dorothy', 'Elizabeth', 'Emily', 'Emma', 'Frances', 'Grace',
  'Heather', 'Helen', 'Isabella', 'Jane', 'Janet', 'Jennifer', 'Jessica', 'Joan', 'Joyce',
  'Julia', 'Julie', 'Karen', 'Katherine', 'Kathleen', 'Kelly', 'Kimberly', 'Laura', 'Lauren',
  'Linda', 'Lisa', 'Margaret', 'Maria', 'Marie', 'Martha', 'Mary', 'Megan', 'Melissa', 'Michelle',
  'Nancy', 'Nicole', 'Olivia', 'Pamela', 'Patricia', 'Rachel', 'Rebecca', 'Rose', 'Ruth',
  'Samantha', 'Sandra', 'Sara', 'Sarah', 'Sharon', 'Shirley', 'Sophia', 'Stephanie', 'Susan',
  'Teresa', 'Theresa', 'Tiffany', 'Victoria', 'Virginia', 'Wendy',
]);

/**
 * Infer gender from a character name
 */
export function inferGender(
  name: string,
  language: 'ru' | 'en' | 'auto' = 'auto'
): 'male' | 'female' | 'unknown' {
  const normalized = name.trim();
  const lang = language === 'auto' ? detectNameLanguage(normalized) : language;

  // Check database first
  if (lang === 'ru') {
    if (RUSSIAN_MALE_NAMES.has(normalized)) return 'male';
    if (RUSSIAN_FEMALE_NAMES.has(normalized)) return 'female';

    // Russian heuristics: names ending in -а/-я/-ия are typically female
    // Names ending in consonants or -й/-ь are typically male
    if (/[аяь]$/i.test(normalized) && !/^[А-Яа-яЁё]+ий$/i.test(normalized)) {
      // Exception: names ending in -ий (like Василий) are male
      if (/ия$/i.test(normalized)) return 'female'; // Мария, София
      if (/[ая]$/i.test(normalized)) return 'female';
    }
    if (/[йнрлв]$/i.test(normalized)) return 'male';
  } else {
    if (ENGLISH_MALE_NAMES.has(normalized)) return 'male';
    if (ENGLISH_FEMALE_NAMES.has(normalized)) return 'female';

    // English heuristics
    if (/[aeiey]$/i.test(normalized)) return 'female'; // Names ending in vowels often female
    if (/^[A-Z][a-z]+(son|ton|ard|bert|rick|ck|er)$/i.test(normalized)) return 'male';
  }

  return 'unknown';
}

/**
 * Detect if a name is Russian or English based on character set
 */
function detectNameLanguage(name: string): 'ru' | 'en' {
  // Check for Cyrillic characters
  if (/[А-Яа-яЁё]/.test(name)) return 'ru';
  return 'en';
}

/**
 * Extract first name from a full name string
 */
export function extractFirstName(fullName: string): string {
  // Handle "LastName FirstName" (Russian style) or "FirstName LastName" (English style)
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return fullName;

  // If first part looks like a title, skip it
  const titles = ['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Prof', 'Sir', 'Lord', 'Lady'];
  if (titles.some(t => parts[0].toLowerCase().startsWith(t.toLowerCase()))) {
    return parts[1] || parts[0];
  }

  return parts[0];
}
