import React from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import "./style.css";

const SUPABASE_URL = "https://txchxfleodgxfiwylwfq.supabase.co/rest/v1/";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4Y2h4Zmxlb2RneGZpd3lsd2ZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxODU2NDQsImV4cCI6MjA5NDc2MTY0NH0.5rgunWXqiPgNMMi40t3mQPB6sXRkhpcpRgoJdVhGmc4";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function App() {
  return (
    <div className="page">
      <h1>E&J Trucking Load Billing</h1>
      <p>App connected. Next step: load entry form + duplicate protection.</p>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);