import { messages } from '../i18n';

export default function NotFound() {
  return (
    <main className="standalone-state">
      <section>
        <h1>{messages.notFound.title}</h1>
        <p>{messages.notFound.description}</p>
      </section>
    </main>
  );
}
