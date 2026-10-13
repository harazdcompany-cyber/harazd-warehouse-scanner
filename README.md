# HARAZD WAREHOUSE V39 — Supabase Edition

Темний сайт для GitHub Pages, хмарна база PostgreSQL/Supabase, авторизація, обладнання, картки, редагування, пошук і сканер.

## 1. Створіть Supabase

1. Відкрийте https://supabase.com/dashboard і створіть проєкт.
2. У **SQL Editor** вставте вміст `database.sql`, натисніть **Run**. Виконувати один раз на чистому проєкті.
3. У **Authentication → Providers → Email** вимкніть публічну реєстрацію (*Allow new users to sign up*). У **Authentication → Users** створіть/запросіть працівників; переконайтеся, що їхні email підтверджені.
4. У **Project Settings → API** (або **Connect → API keys**) скопіюйте Project URL та **publishable key** (або legacy `anon` key). **Ніколи не вставляйте `service_role` чи `secret` key на сайт.**
5. У `config.js` заповніть `SUPABASE_URL` і `SUPABASE_ANON_KEY`.

## 2. Опублікуйте сайт

1. У репозиторії GitHub `harazdcompany-cyber/harazd-warehouse-scanner` завантажте/замініть файли `index.html`, `style.css`, `app.js`, `config.js`. **Не завантажуйте `database.sql` із секретами — у цьому файлі секретів немає, але SQL потрібен тільки в Supabase.**
2. GitHub → **Settings → Pages** → Deploy from a branch → `main` / `(root)` → Save.
3. Відкрийте https://harazdcompany-cyber.github.io/harazd-warehouse-scanner/ після завершення deployment.
4. Зробіть hard refresh (`Ctrl+Shift+R`). Якщо стара PWA-версія все ще відкривається: Chrome DevTools → Application → Service Workers → Unregister, далі Application → Storage → Clear site data, перезавантажте. Старий `sw.js` можна прибрати з репозиторію, щоб старий код не кешувався.
5. Увійдіть за email/паролем користувача Supabase.

## 3. Перша перевірка

У **Довідник** додайте категорію та склад, за потреби підкатегорію. У **Додати** створіть обладнання. Воно з’явиться в **Склад**. Натисніть рядок для картки та редагування. Для камери потрібен HTTPS і дозвіл браузера.

## Безпека та межі V39

- RLS дозволяє читати/змінювати всі записи **будь-якому авторизованому користувачу**. Це модель для довіреної внутрішньої команди, **не** рольова система. Перш ніж запрошувати зовнішніх користувачів, додайте ролі/права доступу.
- Додавання персонального обладнання з кількістю N створює N окремих EQ-ID. Редагування не змінює EQ-ID.
- Фото зберігається URL-посиланням; завантаження файлів у Supabase Storage ще не реалізовано.
- Вебсайт використовує CDN для Supabase JS та html5-qrcode; потрібне підключення до інтернету.
- Імпорт із Google Sheets **не входить** у V39. Стару таблицю не видаляйте до перевірки міграції.
- Вебсайт не містить Google Sheets API; сканер шукає лише товари в Supabase.
- GitHub Pages — публічний статичний хостинг. Захист даних забезпечують Supabase Auth + RLS, не приховування JavaScript.
- Рекомендовано налаштувати резервне копіювання бази та окремі ролі перед використанням у виробництві.
