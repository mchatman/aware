export default function Home() {
  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>Aware API</h1>
      <p>Backend is running. This server provides API endpoints only.</p>
      <p>
        <a href="/api/auth/session">/api/auth/session</a> — Check auth status
      </p>
    </div>
  );
}
