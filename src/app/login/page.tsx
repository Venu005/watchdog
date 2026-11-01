import { LoginForm } from "../../components/forms";
export default function Login() {
  return (
    <main className="login-page">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark">w</span>watchdog.
        </div>
        <div>
          <span className="eyebrow">AUTOMATION ASSURANCE</span>
          <h1>
            Your workflows run.
            <br />
            Did the work
            <br />
            <em>actually happen?</em>
          </h1>
          <p>
            Catch missed runs, empty outputs, and missing destination writes
            before your clients do.
          </p>
        </div>
        <span className="small">
          Built for agencies that stand behind their automations.
        </span>
      </section>
      <section className="login-panel">
        <div className="login-box">
          <span className="eyebrow">YOUR AGENCY WORKSPACE</span>
          <h2>Welcome back.</h2>
          <p className="muted">Sign in to keep an eye on what matters.</p>
          <LoginForm />
          <div className="login-note">
            <span className="dot" /> Independent monitoring. Clear evidence.
          </div>
        </div>
      </section>
    </main>
  );
}
