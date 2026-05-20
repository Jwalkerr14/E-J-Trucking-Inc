import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import "./style.css";
import { createWorker } from "tesseract.js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function calculateCustomerTotals(load) {
  const tons = Number(load.tons || 0);
  const rate = Number(load.rate || 0);
  const fscPercent = Number(load.fsc || 0);

  const baseTotal = tons * rate;
  const fscPerTon = rate * (fscPercent / 100);
  const fscAmount = fscPerTon * tons;
  const withFsc = baseTotal + fscAmount;

  return { baseTotal, fscPerTon, fscAmount, withFsc };
}

function calculateDriverTotals(load) {
  const tons = Number(load.tons || 0);
  const customerRate = Number(load.rate || 0);
  const baseTotal = tons * customerRate;
  const driverPayPercent = Number(load.driver_rate || 0);
  const driverPay = baseTotal * (driverPayPercent / 100);

  return { baseTotal, driverPayPercent, driverPay };
}

function groupBy(loadList, getKey, buildTotals) {
  const grouped = {};

  for (const load of loadList) {
    const groupName = getKey(load) || "Unassigned";

    if (!grouped[groupName]) {
      grouped[groupName] = buildTotals(groupName);
    }

    grouped[groupName].loads.push(load);
  }

  return Object.values(grouped).sort((a, b) => a.name.localeCompare(b.name));
}

function App() {
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [page, setPage] = useState("home");
  const [currentProfile, setCurrentProfile] = useState(null);
  const [loads, setLoads] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [trucks, setTrucks] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [message, setMessage] = useState("");
  const [editingLoadId, setEditingLoadId] = useState(null);
  const [ticketFile, setTicketFile] = useState(null);
  const [ticketPreviewUrl, setTicketPreviewUrl] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [ocrReading, setOcrReading] = useState(false);

  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [customerFilter, setCustomerFilter] = useState("all");
  const [driverFilter, setDriverFilter] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [printMode, setPrintMode] = useState("customer");

  const [loadForm, setLoadForm] = useState({
    load_number: "",
    load_date: new Date().toISOString().slice(0, 10),
    customer: "",
    source_sp: "",
    ship_to: "",
    truck_number: "",
    driver: "",
    tons: "",
    rate: "",
    fsc: "0",
    driver_rate: "",
    ticket_photo_url: "",
    entered_by_driver: false,
    office_reviewed: false
  });

  const [customerForm, setCustomerForm] = useState({
    name: "",
    billing_address: "",
    default_rate: "",
    default_fsc_percent: "0"
  });

  const [driverForm, setDriverForm] = useState({
    name: "",
    address: "",
    reference_number: "",
    default_pay_percent: ""
  });

  const [truckForm, setTruckForm] = useState({
    truck_number: "",
    driver_name: ""
  });

  async function fetchAll() {
    const [loadsResult, customersResult, driversResult, trucksResult, invoicesResult, profilesResult] = await Promise.all([
      supabase.from("loads").select("*").order("load_date", { ascending: false }),
      supabase.from("customers").select("*").eq("active", true).order("name", { ascending: true }),
      supabase.from("drivers").select("*").eq("active", true).order("name", { ascending: true }),
      supabase.from("trucks").select("*").eq("active", true).order("truck_number", { ascending: true }),
      supabase.from("invoices").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("*").order("full_name", { ascending: true })
    ]);

    if (loadsResult.error) setMessage(loadsResult.error.message);
    else setLoads(loadsResult.data || []);

    if (customersResult.error) setMessage(customersResult.error.message);
    else setCustomers(customersResult.data || []);

    if (driversResult.error) setMessage(driversResult.error.message);
    else setDrivers(driversResult.data || []);

    if (trucksResult.error) setMessage(trucksResult.error.message);
    else setTrucks(trucksResult.data || []);

    if (invoicesResult.error) setMessage(invoicesResult.error.message);
    else setInvoices(invoicesResult.data || []);

    if (profilesResult.error) setMessage(profilesResult.error.message);
    else setProfiles(profilesResult.data || []);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (session) {
      fetchAll();
      fetchProfile();
    }
  }, [session]);

  useEffect(() => {
    if (!currentProfile || currentProfile.role !== "driver") return;

    const driverName = currentProfile.full_name || currentProfile.email || "";
    const assignedTruck = trucks.find(truck => truck.driver_name === driverName);
    const matchingDriver = drivers.find(driver => driver.name === driverName);

    setLoadForm(current => ({
      ...current,
      driver: driverName,
      truck_number: assignedTruck?.truck_number || current.truck_number,
      driver_rate: matchingDriver?.default_pay_percent || current.driver_rate
    }));
  }, [currentProfile, trucks, drivers]);

  async function fetchProfile() {
    if (!session?.user) return;

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .maybeSingle();

    if (error) {
      setMessage(error.message);
      return;
    }

    if (!data) {
      const profileToSave = {
        id: session.user.id,
        email: session.user.email,
        full_name: authName || session.user.email,
        role: "dispatcher"
      };

      const { data: newProfile, error: insertError } = await supabase
        .from("profiles")
        .insert([profileToSave])
        .select()
        .single();

      if (insertError) {
        setMessage(insertError.message);
        return;
      }

      setCurrentProfile(newProfile);
    } else {
      setCurrentProfile(data);
    }
  }

  async function handleAuth(e) {
    e.preventDefault();
    setMessage("");

    if (authMode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email: authEmail,
        password: authPassword
      });

      if (error) {
        setMessage(error.message);
        return;
      }

      if (data.user) {
        setMessage("Account created. Check your email if Supabase requires confirmation, then log in.");
        setAuthMode("login");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: authPassword
      });

      if (error) {
        setMessage(error.message);
        return;
      }
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setCurrentProfile(null);
    setPage("home");
  }

  function canSee(section) {
    const role = currentProfile?.role || "dispatcher";

    if (role === "admin") return true;
    if (role === "dispatcher") return ["home", "loads", "customers", "drivers", "trucks", "invoices", "invoicehistory"].includes(section);
    if (role === "driver") return ["home", "loads", "driverpay"].includes(section);

    return false;
  }

  function AuthPage() {
    return (
      <div className="auth-page">
        <form onSubmit={handleAuth} className="auth-card">
          <h1>E&J Trucking</h1>
          <p>{authMode === "login" ? "Log in to your trucking system." : "Create a new user account."}</p>

          {authMode === "signup" && (
            <input
              placeholder="Full Name"
              value={authName}
              onChange={e => setAuthName(e.target.value)}
            />
          )}

          <input
            type="email"
            placeholder="Email"
            value={authEmail}
            onChange={e => setAuthEmail(e.target.value)}
            required
          />

          <input
            type="password"
            placeholder="Password"
            value={authPassword}
            onChange={e => setAuthPassword(e.target.value)}
            required
          />

          <button type="submit">{authMode === "login" ? "Log In" : "Create Account"}</button>

          <button
            type="button"
            className="secondary"
            onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}
          >
            {authMode === "login" ? "Create an account" : "Back to login"}
          </button>

          {message && <div className="message">{message}</div>}
        </form>
      </div>
    );
  }

  function guessTicketFields(text) {
    const cleanText = text.replace(/[ 

	]+/g, " ").trim();

    const bolMatch =
      cleanText.match(/(?:BOL|LOAD|TICKET|TKT|SLIP)[ #:.\-]*([A-Z0-9\-]{4,})/i) ||
      cleanText.match(/([A-Z]{1,4}\-?[0-9]{4,})/i);

    const tonsMatch =
      cleanText.match(/(?:TONS?|NET TONS?|QTY|QUANTITY)[ #:.\-]*([0-9]+(?:\.[0-9]+)?)/i) ||
      cleanText.match(/([0-9]+(?:\.[0-9]+)?) *(?:TONS?|TN)/i);

    const sourceMatch = cleanText.match(/(?:SOURCE|PLANT|FROM|PIT|QUARRY)[ #:.\-]*([A-Z0-9 &'\/\-]{3,40})/i);
    const shipToMatch = cleanText.match(/(?:SHIP TO|DESTINATION|JOB)[ #:.\-]*([A-Z0-9 &'\/\-]{3,40})/i);

    return {
      load_number: bolMatch?.[1]?.trim() || "",
      tons: tonsMatch?.[1]?.trim() || "",
      source_sp: sourceMatch?.[1]?.trim() || "",
      ship_to: shipToMatch?.[1]?.trim() || ""
    };
  }

  function applyTicketGuesses(text) {
    const guesses = guessTicketFields(text);

    setLoadForm(current => ({
      ...current,
      load_number: guesses.load_number || current.load_number,
      tons: guesses.tons || current.tons,
      source_sp: guesses.source_sp || current.source_sp,
      ship_to: guesses.ship_to || current.ship_to
    }));
  }

  async function readTicketPhoto() {
    if (!ticketFile) {
      setMessage("Upload a ticket photo first.");
      return;
    }

    setOcrReading(true);
    setMessage("Reading ticket photo...");

    try {
      const worker = await createWorker("eng");
      const result = await worker.recognize(ticketFile);
      await worker.terminate();

      const text = result.data.text || "";
      setOcrText(text);
      applyTicketGuesses(text);
      setMessage("Ticket photo read. Check the auto-filled fields before saving.");
    } catch (error) {
      setMessage(`Could not read ticket photo: ${error.message}`);
    } finally {
      setOcrReading(false);
    }
  }

  function handleTicketFileChange(file) {
    setTicketFile(file || null);
    setOcrText("");

    if (ticketPreviewUrl) {
      URL.revokeObjectURL(ticketPreviewUrl);
    }

    if (file) {
      setTicketPreviewUrl(URL.createObjectURL(file));
    } else {
      setTicketPreviewUrl("");
    }
  }

  function updateLoadField(field, value) {
    let nextForm = { ...loadForm, [field]: value };

    if (field === "customer") {
      const selectedCustomer = customers.find(customer => customer.name === value);
      if (selectedCustomer) {
        nextForm.rate = selectedCustomer.default_rate;
        nextForm.fsc = selectedCustomer.default_fsc_percent;
      }
    }

    if (field === "driver") {
      const selectedDriver = drivers.find(driver => driver.name === value);
      if (selectedDriver) {
        nextForm.driver_rate = selectedDriver.default_pay_percent;
      }
    }

    if (field === "truck_number") {
      const selectedTruck = trucks.find(truck => truck.truck_number === value);
      if (selectedTruck?.driver_name) {
        nextForm.driver = selectedTruck.driver_name;
        const selectedDriver = drivers.find(driver => driver.name === selectedTruck.driver_name);
        if (selectedDriver) {
          nextForm.driver_rate = selectedDriver.default_pay_percent;
        }
      }
    }

    setLoadForm(nextForm);
    setMessage("");
  }

  async function saveLoad(e) {
    e.preventDefault();

    let ticketPhotoUrl = loadForm.ticket_photo_url || "";

    if (ticketFile) {
      const safeLoadNumber = loadForm.load_number.trim().toUpperCase().replace(/[^A-Z0-9-_]/g, "-");
      const fileExt = ticketFile.name.split(".").pop();
      const fileName = `${safeLoadNumber}-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("load-tickets")
        .upload(fileName, ticketFile);

      if (uploadError) {
        setMessage(uploadError.message);
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from("load-tickets")
        .getPublicUrl(fileName);

      ticketPhotoUrl = publicUrlData.publicUrl;
    }

    const loadToSave = {
      ...loadForm,
      load_number: loadForm.load_number.trim().toUpperCase(),
      tons: Number(loadForm.tons || 0),
      rate: Number(loadForm.rate || 0),
      fsc: Number(loadForm.fsc || 0),
      driver_rate: Number(loadForm.driver_rate || 0),
      ticket_photo_url: ticketPhotoUrl,
      entered_by_driver: Boolean(ticketPhotoUrl),
      office_reviewed: false
    };

    let error;

    if (editingLoadId) {
      const result = await supabase
        .from("loads")
        .update(loadToSave)
        .eq("id", editingLoadId);

      error = result.error;
    } else {
      const result = await supabase
        .from("loads")
        .insert([loadToSave]);

      error = result.error;
    }

    if (error) {
      if (error.message.includes("duplicate")) {
        setMessage("Duplicate blocked: that load/BOL number is already used.");
      } else {
        setMessage(error.message);
      }
      return;
    }

    setMessage(editingLoadId ? "Load updated successfully." : "Load saved successfully.");
    setEditingLoadId(null);
    setTicketFile(null);

    setLoadForm({
      load_number: "",
      load_date: new Date().toISOString().slice(0, 10),
      customer: loadForm.customer,
      source_sp: "",
      ship_to: "",
      truck_number: loadForm.truck_number,
      driver: loadForm.driver,
      tons: "",
      rate: loadForm.rate,
      fsc: loadForm.fsc,
      driver_rate: loadForm.driver_rate,
      ticket_photo_url: "",
      entered_by_driver: false,
      office_reviewed: false
    });

    fetchAll();
  }

  function startEditLoad(load) {
    setEditingLoadId(load.id);
    setLoadForm({
      load_number: load.load_number || "",
      load_date: load.load_date || new Date().toISOString().slice(0, 10),
      customer: load.customer || "",
      source_sp: load.source_sp || "",
      ship_to: load.ship_to || "",
      truck_number: load.truck_number || "",
      driver: load.driver || "",
      tons: load.tons || "",
      rate: load.rate || "",
      fsc: load.fsc || "0",
      driver_rate: load.driver_rate || "",
      ticket_photo_url: load.ticket_photo_url || "",
      entered_by_driver: load.entered_by_driver || false,
      office_reviewed: load.office_reviewed || false
    });
    setTicketFile(null);
    setPage("loads");
    setMessage(`Editing load ${load.load_number}. Make changes and click Update Load.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEditLoad() {
    setEditingLoadId(null);
    setLoadForm({
      load_number: "",
      load_date: new Date().toISOString().slice(0, 10),
      customer: "",
      source_sp: "",
      ship_to: "",
      truck_number: "",
      driver: "",
      tons: "",
      rate: "",
      fsc: "0",
      driver_rate: "",
      ticket_photo_url: "",
      entered_by_driver: false,
      office_reviewed: false
    });
    setTicketFile(null);
    setMessage("Edit cancelled.");
  }

  async function saveCustomer(e) {
    e.preventDefault();

    const { error } = await supabase.from("customers").insert([{
      name: customerForm.name.trim(),
      billing_address: customerForm.billing_address.trim(),
      default_rate: Number(customerForm.default_rate || 0),
      default_fsc_percent: Number(customerForm.default_fsc_percent || 0)
    }]);

    if (error) {
      setMessage(error.message.includes("duplicate") ? "That customer already exists." : error.message);
      return;
    }

    setMessage("Customer saved.");
    setCustomerForm({ name: "", billing_address: "", default_rate: "", default_fsc_percent: "0" });
    fetchAll();
  }

  async function saveDriver(e) {
    e.preventDefault();

    const { error } = await supabase.from("drivers").insert([{
      name: driverForm.name.trim(),
      address: driverForm.address.trim(),
      reference_number: driverForm.reference_number.trim(),
      default_pay_percent: Number(driverForm.default_pay_percent || 0)
    }]);

    if (error) {
      setMessage(error.message.includes("duplicate") ? "That driver already exists." : error.message);
      return;
    }

    setMessage("Driver saved.");
    setDriverForm({ name: "", address: "", reference_number: "", default_pay_percent: "" });
    fetchAll();
  }

  async function saveTruck(e) {
    e.preventDefault();

    const { error } = await supabase.from("trucks").insert([{
      truck_number: truckForm.truck_number.trim(),
      driver_name: truckForm.driver_name.trim()
    }]);

    if (error) {
      setMessage(error.message.includes("duplicate") ? "That truck already exists." : error.message);
      return;
    }

    setMessage("Truck saved.");
    setTruckForm({ truck_number: "", driver_name: "" });
    fetchAll();
  }

  const filteredLoads = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const role = currentProfile?.role || "dispatcher";
    const userName = currentProfile?.full_name || "";

    return loads.filter(load => {
      const matchesSearch = !q || [
        load.load_number,
        load.customer,
        load.source_sp,
        load.ship_to,
        load.truck_number,
        load.driver,
        load.load_date
      ].join(" ").toLowerCase().includes(q);

      const driverCanSee = role !== "driver" || load.driver === userName || load.driver === session?.user?.email;

      return matchesSearch && driverCanSee;
    });
  }, [loads, searchText, currentProfile, session]);

  const invoiceLoads = useMemo(() => {
    return filteredLoads.filter(load => {
      const inDateRange = load.load_date >= startDate && load.load_date <= endDate;
      const matchesCustomer = customerFilter === "all" || load.customer === customerFilter;
      const matchesDriver = driverFilter === "all" || load.driver === driverFilter;

      return inDateRange && matchesCustomer && matchesDriver && !load.billed;
    });
  }, [filteredLoads, startDate, endDate, customerFilter, driverFilter]);

  const customerInvoices = useMemo(() => {
    const groups = groupBy(invoiceLoads, load => load.customer, name => ({
      name,
      loads: [],
      tons: 0,
      subtotal: 0,
      fsc: 0,
      total: 0
    }));

    for (const group of groups) {
      for (const load of group.loads) {
        const totals = calculateCustomerTotals(load);
        group.tons += Number(load.tons || 0);
        group.subtotal += totals.baseTotal;
        group.fsc += totals.fscAmount;
        group.total += totals.withFsc;
      }
    }

    return groups;
  }, [invoiceLoads]);

  const driverPaySheets = useMemo(() => {
    const groups = groupBy(invoiceLoads, load => load.driver, name => {
      const matchingDriver = drivers.find(driver => driver.name === name);

      return {
        name,
        loads: [],
        tons: 0,
        pay: 0,
        address: matchingDriver?.address || "",
        reference_number: matchingDriver?.reference_number || ""
      };
    });

    for (const group of groups) {
      for (const load of group.loads) {
        const totals = calculateDriverTotals(load);
        group.tons += Number(load.tons || 0);
        group.pay += totals.driverPay;
      }
    }

    return groups;
  }, [invoiceLoads, drivers]);

  async function createInvoicesFromFilters() {
    if (customerInvoices.length === 0) {
      setMessage("No unbilled loads match these filters.");
      return;
    }

    const createdInvoiceNumbers = [];

    for (const group of customerInvoices) {
      const invoiceNumber = `INV-${Date.now()}-${createdInvoiceNumbers.length + 1}`;
      const loadIds = group.loads.map(load => load.id);

      const { error: invoiceError } = await supabase.from("invoices").insert([{
        invoice_number: invoiceNumber,
        customer: group.name,
        start_date: startDate,
        end_date: endDate,
        loads_count: group.loads.length,
        tons: group.tons,
        base_subtotal: group.subtotal,
        fsc_total: group.fsc,
        total_with_fsc: group.total,
        customer_paid: false
      }]);

      if (invoiceError) {
        setMessage(invoiceError.message);
        return;
      }

      const { error: loadError } = await supabase
        .from("loads")
        .update({
          billed: true,
          invoice_number: invoiceNumber
        })
        .in("id", loadIds);

      if (loadError) {
        setMessage(loadError.message);
        return;
      }

      createdInvoiceNumbers.push(invoiceNumber);
    }

    setMessage(`Created ${createdInvoiceNumbers.length} invoice(s): ${createdInvoiceNumbers.join(", ")}`);
    fetchAll();
  }

  async function markShownAsBilled() {
    if (invoiceLoads.length === 0) {
      setMessage("No unbilled loads showing.");
      return;
    }

    const ids = invoiceLoads.map(load => load.id);
    const { error } = await supabase.from("loads").update({ billed: true }).in("id", ids);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(`${invoiceLoads.length} loads marked as billed.`);
    fetchAll();
  }

  async function markShownAsReviewed() {
    if (invoiceLoads.length === 0) {
      setMessage("No loads showing to review.");
      return;
    }

    const ids = invoiceLoads.map(load => load.id);
    const { error } = await supabase
      .from("loads")
      .update({ office_reviewed: true })
      .in("id", ids);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(`${invoiceLoads.length} loads marked as office reviewed.`);
    fetchAll();
  }

  async function markShownAsDriverPaid() {
    if (invoiceLoads.length === 0) {
      setMessage("No loads showing to mark driver paid.");
      return;
    }

    const ids = invoiceLoads.map(load => load.id);
    const { error } = await supabase
      .from("loads")
      .update({ paid: true })
      .in("id", ids);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(`${invoiceLoads.length} loads marked as driver paid.`);
    fetchAll();
  }

  async function markShownAsCustomerPaid() {
    if (invoiceLoads.length === 0) {
      setMessage("No loads showing to mark customer paid.");
      return;
    }

    const ids = invoiceLoads.map(load => load.id);
    const { error } = await supabase
      .from("loads")
      .update({ customer_paid: true })
      .in("id", ids);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(`${invoiceLoads.length} loads marked as customer paid.`);
    fetchAll();
  }

  async function deleteLoad(load) {
    if ((currentProfile?.role || "dispatcher") !== "admin") {
      setMessage("Only admin users can delete loads.");
      return;
    }

    const confirmed = window.confirm(`Delete load ${load.load_number}? This cannot be undone.`);
    if (!confirmed) return;

    const { error } = await supabase
      .from("loads")
      .delete()
      .eq("id", load.id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(`Load ${load.load_number} deleted.`);
    fetchAll();
  }

  function StatusBadge({ yes, labelYes = "Yes", labelNo = "No" }) {
    return <span className={yes ? "badge badge-green" : "badge badge-red"}>{yes ? labelYes : labelNo}</span>;
  }

  function printInvoices(mode) {
    setPrintMode(mode);
    setTimeout(() => window.print(), 100);
  }

  function NavButton({ id, label }) {
    if (!canSee(id)) return null;

    return (
      <button type="button" className={page === id ? "nav active" : "nav"} onClick={() => setPage(id)}>
        {label}
      </button>
    );
  }

  function PageHeader({ title, subtitle }) {
    return (
      <div className="page-header">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
    );
  }

  function HomePage() {
    const unbilledCount = loads.filter(load => !load.billed).length;
    const billedCount = loads.filter(load => load.billed).length;
    const totalUnbilledCustomer = invoiceLoads.reduce((sum, load) => sum + calculateCustomerTotals(load).withFsc, 0);
    const totalUnbilledDriver = invoiceLoads.reduce((sum, load) => sum + calculateDriverTotals(load).driverPay, 0);

    function DashboardCard({ label, value, targetPage, setFilter }) {
      return (
        <button
          type="button"
          className="card stat dashboard-button"
          onClick={() => {
            if (setFilter) setFilter();
            setPage(targetPage);
          }}
        >
          <span>{label}</span>
          <strong>{value}</strong>
        </button>
      );
    }

    return (
      <>
        <PageHeader title="Dashboard" subtitle="Quick totals for your trucking billing system." />
        <div className="summary-grid">
          <DashboardCard label="Total Loads" value={loads.length} targetPage="loads" />
          <DashboardCard label="Unbilled Loads" value={unbilledCount} targetPage="invoices" />
          <DashboardCard label="Billed Loads" value={billedCount} targetPage="invoices" />
          <DashboardCard label="Customers" value={customers.length} targetPage="customers" />
          <DashboardCard label="Drivers" value={drivers.length} targetPage="drivers" />
          <DashboardCard label="Trucks" value={trucks.length} targetPage="trucks" />
          <DashboardCard label="Filtered Customer Billing" value={money(totalUnbilledCustomer)} targetPage="invoices" />
          <DashboardCard label="Filtered Driver Pay" value={money(totalUnbilledDriver)} targetPage="driverpay" />
        </div>
      </>
    );
  }

  function LoadsPage() {
    return (
      <>
        <PageHeader title="Load Entry" subtitle="Add loads here. Customer, driver, and truck setup flows into this page." />

        <form onSubmit={saveLoad} className="card form">
          <h2>{editingLoadId ? "Edit Load" : "Add Load"}</h2>

          <input placeholder="BOL / Load #" value={loadForm.load_number} onChange={e => updateLoadField("load_number", e.target.value)} required />
          <input type="date" value={loadForm.load_date} onChange={e => updateLoadField("load_date", e.target.value)} required />

          <select value={loadForm.customer} onChange={e => updateLoadField("customer", e.target.value)} required>
            <option value="">Select Customer</option>
            {customers.map(customer => <option key={customer.id} value={customer.name}>{customer.name}</option>)}
          </select>

          <input placeholder="Source SP" value={loadForm.source_sp} onChange={e => updateLoadField("source_sp", e.target.value)} />
          <input placeholder="Ship To" value={loadForm.ship_to} onChange={e => updateLoadField("ship_to", e.target.value)} />

          <select
            value={loadForm.truck_number}
            onChange={e => updateLoadField("truck_number", e.target.value)}
            disabled={(currentProfile?.role || "dispatcher") === "driver"}
          >
            <option value="">Select Truck</option>
            {trucks.map(truck => <option key={truck.id} value={truck.truck_number}>{truck.truck_number}</option>)}
          </select>

          <select
            value={loadForm.driver}
            onChange={e => updateLoadField("driver", e.target.value)}
            disabled={(currentProfile?.role || "dispatcher") === "driver"}
          >
            <option value="">Select Driver</option>
            {drivers.map(driver => <option key={driver.id} value={driver.name}>{driver.name}</option>)}
          </select>

          <input type="number" step="0.01" placeholder="Tons" value={loadForm.tons} onChange={e => updateLoadField("tons", e.target.value)} />
          <input type="number" step="0.01" placeholder="Customer Rate Per Ton" value={loadForm.rate} onChange={e => updateLoadField("rate", e.target.value)} />
          <input type="number" step="0.01" placeholder="FSC %" value={loadForm.fsc} onChange={e => updateLoadField("fsc", e.target.value)} />
          <input
            type="number"
            step="0.01"
            placeholder="Driver Pay %"
            value={loadForm.driver_rate}
            onChange={e => updateLoadField("driver_rate", e.target.value)}
            disabled={(currentProfile?.role || "dispatcher") === "driver"}
          />

          <label className="file-input">
            Ticket / BOL Photo
            <input type="file" accept="image/*" onChange={e => handleTicketFileChange(e.target.files?.[0] || null)} />
          </label>

          {ticketPreviewUrl && (
            <div className="ticket-preview-box">
              <img src={ticketPreviewUrl} alt="Ticket preview" className="ticket-preview" />
              <button type="button" className="secondary" onClick={readTicketPhoto} disabled={ocrReading}>
                {ocrReading ? "Reading Ticket..." : "Read Ticket Photo"}
              </button>
            </div>
          )}

          {ocrText && (
            <details className="ocr-details">
              <summary>View OCR Text</summary>
              <pre>{ocrText}</pre>
            </details>
          )}

          {loadForm.ticket_photo_url && (
            <a href={loadForm.ticket_photo_url} target="_blank" rel="noreferrer" className="photo-link">
              View Current Ticket Photo
            </a>
          )}

          <button type="submit">{editingLoadId ? "Update Load" : "Save Load"}</button>
          {editingLoadId && (
            <button type="button" className="secondary" onClick={cancelEditLoad}>
              Cancel Edit
            </button>
          )}
        </form>

        <LoadTable title="Recent Loads" rows={filteredLoads} showBilling />
      </>
    );
  }

  function CustomersPage() {
    return (
      <>
        <PageHeader title="Customers" subtitle="Add the companies you haul for. Default rate and FSC will auto-fill on load entry." />
        <form onSubmit={saveCustomer} className="card form">
          <h2>Add Customer</h2>
          <input placeholder="Customer Name" value={customerForm.name} onChange={e => setCustomerForm({ ...customerForm, name: e.target.value })} required />
          <input placeholder="Billing Address" value={customerForm.billing_address} onChange={e => setCustomerForm({ ...customerForm, billing_address: e.target.value })} />
          <input type="number" step="0.01" placeholder="Default Customer Rate Per Ton" value={customerForm.default_rate} onChange={e => setCustomerForm({ ...customerForm, default_rate: e.target.value })} />
          <input type="number" step="0.01" placeholder="Default FSC %" value={customerForm.default_fsc_percent} onChange={e => setCustomerForm({ ...customerForm, default_fsc_percent: e.target.value })} />
          <button type="submit">Save Customer</button>
        </form>

        <div className="card">
          <h2>Customer List</h2>
          <table>
            <thead><tr><th>Name</th><th>Billing Address</th><th>Default Rate/Ton</th><th>Default FSC %</th></tr></thead>
            <tbody>
              {customers.map(customer => (
                <tr key={customer.id}>
                  <td>{customer.name}</td>
                  <td>{customer.billing_address}</td>
                  <td>{money(customer.default_rate)}</td>
                  <td>{Number(customer.default_fsc_percent || 0).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  function DriversPage() {
    return (
      <>
        <PageHeader title="Drivers" subtitle="Add drivers, address, reference number, and default pay percent." />
        <form onSubmit={saveDriver} className="card form">
          <h2>Add Driver</h2>
          <input placeholder="Driver Name" value={driverForm.name} onChange={e => setDriverForm({ ...driverForm, name: e.target.value })} required />
          <input placeholder="Address" value={driverForm.address} onChange={e => setDriverForm({ ...driverForm, address: e.target.value })} />
          <input placeholder="Reference Number" value={driverForm.reference_number} onChange={e => setDriverForm({ ...driverForm, reference_number: e.target.value })} />
          <input type="number" step="0.01" placeholder="Pay %" value={driverForm.default_pay_percent} onChange={e => setDriverForm({ ...driverForm, default_pay_percent: e.target.value })} />
          <button type="submit">Save Driver</button>
        </form>

        <div className="card">
          <h2>Driver List</h2>
          <table>
            <thead><tr><th>Name</th><th>Address</th><th>Reference #</th><th>Pay %</th></tr></thead>
            <tbody>
              {drivers.map(driver => (
                <tr key={driver.id}>
                  <td>{driver.name}</td>
                  <td>{driver.address}</td>
                  <td>{driver.reference_number}</td>
                  <td>{Number(driver.default_pay_percent || 0).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  function TrucksPage() {
    return (
      <>
        <PageHeader title="Trucks" subtitle="Add truck numbers and optionally assign a default driver." />
        <form onSubmit={saveTruck} className="card form">
          <h2>Add Truck</h2>
          <input placeholder="Truck #" value={truckForm.truck_number} onChange={e => setTruckForm({ ...truckForm, truck_number: e.target.value })} required />
          <select value={truckForm.driver_name} onChange={e => setTruckForm({ ...truckForm, driver_name: e.target.value })}>
            <option value="">No Default Driver</option>
            {drivers.map(driver => <option key={driver.id} value={driver.name}>{driver.name}</option>)}
          </select>
          <button type="submit">Save Truck</button>
        </form>

        <div className="card">
          <h2>Truck List</h2>
          <table>
            <thead><tr><th>Truck #</th><th>Default Driver</th></tr></thead>
            <tbody>
              {trucks.map(truck => (
                <tr key={truck.id}>
                  <td>{truck.truck_number}</td>
                  <td>{truck.driver_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  function Filters() {
    return (
      <div className="card">
        <h2>Filters</h2>
        <div className="filters">
          <label>Start Date<input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
          <label>End Date<input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></label>
          <label>Customer<select value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}><option value="all">All Customers</option>{customers.map(customer => <option key={customer.id} value={customer.name}>{customer.name}</option>)}</select></label>
          <label>Driver<select value={driverFilter} onChange={e => setDriverFilter(e.target.value)}><option value="all">All Drivers</option>{drivers.map(driver => <option key={driver.id} value={driver.name}>{driver.name}</option>)}</select></label>
          <label>Search<input placeholder="Search BOL, customer, driver, truck..." value={searchText} onChange={e => setSearchText(e.target.value)} /></label>
        </div>
      </div>
    );
  }

  function InvoicesPage() {
    return (
      <>
        <PageHeader title="Customer Invoices" subtitle="Build and print customer invoices from unbilled loads." />
        <Filters />
        <div className="card">
          <div className="button-row">
            <button type="button" onClick={() => printInvoices("customer")} className="secondary">Print Customer Invoices</button>
            <button type="button" onClick={createInvoicesFromFilters} className="secondary">Create Invoice From Filters</button>
            <button type="button" onClick={markShownAsReviewed} className="secondary">Mark Office Reviewed</button>
            <button type="button" onClick={markShownAsBilled} className="secondary">Mark Shown Loads As Billed</button>
            <button type="button" onClick={markShownAsCustomerPaid} className="secondary">Mark Customer Paid</button>
          </div>
          <h2>Unbilled Customer Invoice Summary</h2>
          <table>
            <thead><tr><th>Customer</th><th>Loads</th><th>Tons</th><th>Base Subtotal</th><th>FSC Total</th><th>Total With FSC</th></tr></thead>
            <tbody>
              {customerInvoices.map(group => (
                <tr key={group.name}>
                  <td>{group.name}</td>
                  <td>{group.loads.length}</td>
                  <td>{group.tons.toFixed(2)}</td>
                  <td>{money(group.subtotal)}</td>
                  <td>{money(group.fsc)}</td>
                  <td><strong>{money(group.total)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <LoadTable title="Unbilled Loads In Invoice Batch" rows={invoiceLoads} showBilling showCustomerMoney />
      </>
    );
  }

  async function updateUserRole(profileId, role) {
    const { error } = await supabase
      .from("profiles")
      .update({ role })
      .eq("id", profileId);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("User role updated.");
    fetchAll();
  }

  async function toggleUserActive(profile) {
    const { error } = await supabase
      .from("profiles")
      .update({ active: !profile.active })
      .eq("id", profile.id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(`User ${profile.active ? "deactivated" : "activated"}.`);
    fetchAll();
  }

  function UserManagementPage() {
    return (
      <>
        <PageHeader title="User Management" subtitle="Manage user roles and account access." />

        <div className="card">
          <h2>System Users</h2>

          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {profiles.map(profile => (
                <tr key={profile.id}>
                  <td>{profile.full_name}</td>
                  <td>{profile.email}</td>

                  <td>
                    <select
                      value={profile.role || "dispatcher"}
                      onChange={e => updateUserRole(profile.id, e.target.value)}
                    >
                      <option value="admin">Admin</option>
                      <option value="dispatcher">Dispatcher</option>
                      <option value="driver">Driver</option>
                    </select>
                  </td>

                  <td>
                    <StatusBadge
                      yes={profile.active}
                      labelYes="Active"
                      labelNo="Inactive"
                    />
                  </td>

                  <td>
                    <button
                      type="button"
                      className={profile.active ? "small-button danger" : "small-button secondary"}
                      onClick={() => toggleUserActive(profile)}
                    >
                      {profile.active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  function InvoiceHistoryPage() {
    return (
      <>
        <PageHeader title="Invoice History" subtitle="Saved invoices created from your filtered unbilled loads." />
        <div className="card">
          <h2>Saved Invoices</h2>
          <table>
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Date Created</th>
                <th>Customer</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th>Loads</th>
                <th>Tons</th>
                <th>Base Subtotal</th>
                <th>FSC Total</th>
                <th>Total</th>
                <th>Customer Paid</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(invoice => (
                <tr key={invoice.id}>
                  <td><strong>{invoice.invoice_number}</strong></td>
                  <td>{new Date(invoice.created_at).toLocaleDateString()}</td>
                  <td>{invoice.customer}</td>
                  <td>{invoice.start_date}</td>
                  <td>{invoice.end_date}</td>
                  <td>{invoice.loads_count}</td>
                  <td>{Number(invoice.tons || 0).toFixed(2)}</td>
                  <td>{money(invoice.base_subtotal)}</td>
                  <td>{money(invoice.fsc_total)}</td>
                  <td><strong>{money(invoice.total_with_fsc)}</strong></td>
                  <td><StatusBadge yes={invoice.customer_paid} /></td>
                </tr>
              ))}
              {invoices.length === 0 && <tr><td colSpan="11">No saved invoices yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  function DriverPayPage() {
    return (
      <>
        <PageHeader title="Driver Pay" subtitle="Build and print driver pay sheets from unbilled loads." />
        <Filters />
        <div className="card">
          <div className="button-row">
            <button type="button" onClick={() => printInvoices("driver")} className="secondary">Print Driver Pay Sheets</button>
            <button type="button" onClick={markShownAsReviewed} className="secondary">Mark Office Reviewed</button>
            <button type="button" onClick={markShownAsDriverPaid} className="secondary">Mark Driver Paid</button>
          </div>
          <h2>Unbilled Driver Pay Summary</h2>
          <table>
            <thead><tr><th>Driver</th><th>Loads</th><th>Tons</th><th>Driver Pay Total</th></tr></thead>
            <tbody>
              {driverPaySheets.map(group => (
                <tr key={group.name}>
                  <td>{group.name}</td>
                  <td>{group.loads.length}</td>
                  <td>{group.tons.toFixed(2)}</td>
                  <td><strong>{money(group.pay)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <LoadTable title="Unbilled Loads In Driver Pay Batch" rows={invoiceLoads} showDriverMoney />
      </>
    );
  }

  function LoadTable({ title, rows, showBilling, showCustomerMoney, showDriverMoney }) {
    return (
      <div className="card">
        <h2>{title}</h2>
        <table>
          <thead>
            <tr>
              <th>Date</th><th>BOL/Load #</th><th>Customer</th><th>Source</th><th>Ship To</th><th>Truck</th><th>Driver</th><th>Tons</th>
              {(showCustomerMoney || showBilling) && <><th>Rate/Ton</th><th>FSC %</th></>}
              {showCustomerMoney && <><th>Base Total</th><th>FSC Amount</th><th>Total w/ FSC</th></>}
              {showDriverMoney && <><th>Driver Pay %</th><th>Driver Pay</th></>}
              {showBilling && <><th>Ticket Photo</th><th>Office Reviewed</th><th>Billed</th><th>Customer Paid</th><th>Driver Paid</th><th>Actions</th></>}
            </tr>
          </thead>
          <tbody>
            {rows.map(load => {
              const customerTotals = calculateCustomerTotals(load);
              const driverTotals = calculateDriverTotals(load);
              return (
                <tr key={load.id}>
                  <td>{load.load_date}</td><td>{load.load_number}</td><td>{load.customer}</td><td>{load.source_sp}</td><td>{load.ship_to}</td><td>{load.truck_number}</td><td>{load.driver}</td><td>{Number(load.tons || 0).toFixed(2)}</td>
                  {(showCustomerMoney || showBilling) && <><td>{money(load.rate)}</td><td>{Number(load.fsc || 0).toFixed(2)}%</td></>}
                  {showCustomerMoney && <><td>{money(customerTotals.baseTotal)}</td><td>{money(customerTotals.fscAmount)}</td><td><strong>{money(customerTotals.withFsc)}</strong></td></>}
                  {showDriverMoney && <><td>{Number(load.driver_rate || 0).toFixed(2)}%</td><td><strong>{money(driverTotals.driverPay)}</strong></td></>}
                  {showBilling && <><td>{load.ticket_photo_url ? <a href={load.ticket_photo_url} target="_blank" rel="noreferrer">View Photo</a> : "No"}</td><td><StatusBadge yes={load.office_reviewed} /></td><td><StatusBadge yes={load.billed} /></td><td><StatusBadge yes={load.customer_paid} /></td><td><StatusBadge yes={load.paid} /></td><td><button type="button" className="small-button" onClick={() => startEditLoad(load)}>Edit</button>{(currentProfile?.role || "dispatcher") === "admin" && <button type="button" className="small-button danger" onClick={() => deleteLoad(load)}>Delete</button>}</td></>}
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan="20">No loads found.</td></tr>}
          </tbody>
        </table>
      </div>
    );
  }

  function PrintSection({ title, groups, type }) {
    return (
      <div className="print-area">
        {groups.map(group => (
          <div className="print-page" key={`${type}-${group.name}`}>
            <div className="print-header">
              <div><h1>E&J Trucking Inc</h1><p>Liberty, PA</p></div>
              <div className="print-title"><h2>{title}</h2><p>{startDate} to {endDate}</p></div>
            </div>
            <div className="bill-to">
              <strong>{type === "customer" ? "Bill To:" : "Driver:"}</strong>
              <span>{group.name}</span>

              {type === "driver" && (
                <div className="driver-print-details">
                  <div><strong>Address:</strong> {group.address || "N/A"}</div>
                  <div><strong>Reference #:</strong> {group.reference_number || "N/A"}</div>
                </div>
              )}
            </div>

            {type === "customer" ? (
              <>
                <table>
                  <thead><tr><th>Date</th><th>BOL/Load #</th><th>Source</th><th>Ship To</th><th>Truck</th><th>Driver</th><th>Tons</th><th>Rate/Ton</th><th>Base Total</th><th>FSC %</th><th>FSC Amount</th><th>Total w/ FSC</th></tr></thead>
                  <tbody>
                    {group.loads.map(load => {
                      const totals = calculateCustomerTotals(load);
                      return <tr key={load.id}><td>{load.load_date}</td><td>{load.load_number}</td><td>{load.source_sp}</td><td>{load.ship_to}</td><td>{load.truck_number}</td><td>{load.driver}</td><td>{Number(load.tons || 0).toFixed(2)}</td><td>{money(load.rate)}</td><td>{money(totals.baseTotal)}</td><td>{Number(load.fsc || 0).toFixed(2)}%</td><td>{money(totals.fscAmount)}</td><td><strong>{money(totals.withFsc)}</strong></td></tr>;
                    })}
                  </tbody>
                </table>
                <div className="print-totals"><div>Total Loads: <strong>{group.loads.length}</strong></div><div>Total Tons: <strong>{group.tons.toFixed(2)}</strong></div><div>Base Subtotal: <strong>{money(group.subtotal)}</strong></div><div>FSC Total: <strong>{money(group.fsc)}</strong></div><div className="grand-total">Total With FSC: <strong>{money(group.total)}</strong></div></div>
              </>
            ) : (
              <>
                <table>
                  <thead><tr><th>Date</th><th>BOL/Load #</th><th>Customer</th><th>Source</th><th>Ship To</th><th>Truck</th><th>Tons</th><th>Pay Rate/Ton</th><th>Driver Pay</th></tr></thead>
                  <tbody>
                    {group.loads.map(load => {
                      const totals = calculateDriverTotals(load);
                      const payRatePerTon = Number(load.rate || 0) * (Number(load.driver_rate || 0) / 100);
                      return <tr key={load.id}><td>{load.load_date}</td><td>{load.load_number}</td><td>{load.customer}</td><td>{load.source_sp}</td><td>{load.ship_to}</td><td>{load.truck_number}</td><td>{Number(load.tons || 0).toFixed(2)}</td><td>{money(payRatePerTon)}</td><td><strong>{money(totals.driverPay)}</strong></td></tr>;
                    })}
                  </tbody>
                </table>
                <div className="print-totals"><div>Total Loads: <strong>{group.loads.length}</strong></div><div>Total Tons: <strong>{group.tons.toFixed(2)}</strong></div><div className="grand-total">Driver Pay Total: <strong>{money(group.pay)}</strong></div></div>
              </>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (!session) {
    return AuthPage();
  }

  return (
    <div className="page">
      <div className="screen-area">
        <div className="topbar">
          <div className="topbar-header">
          <div className="brand">E&J Trucking</div>
          <div className="user-bar">
            <span className="user-name">
              {currentProfile?.full_name || session?.user?.email}
            </span>

            <span className="role-badge">
              {currentProfile?.role || "dispatcher"}
            </span>

            <button
              type="button"
              className="small-button"
              onClick={signOut}
            >
              Sign Out
            </button>
          </div>
          <div className="nav-row">
            <NavButton id="home" label="Home" />
            <NavButton id="loads" label="Loads" />
            <NavButton id="customers" label="Customers" />
            <NavButton id="drivers" label="Drivers" />
            <NavButton id="trucks" label="Trucks" />
            <NavButton id="invoices" label="Invoices" />
            <NavButton id="invoicehistory" label="Invoice History" />
            {(currentProfile?.role || "dispatcher") === "admin" && <NavButton id="users" label="Users" />}
            <NavButton id="driverpay" label="Driver Pay" />
          </div>
        </div>
          </div>

        {message && <div className="message">{message}</div>}

        {page === "home" && HomePage()}
        {page === "loads" && LoadsPage()}
        {page === "customers" && CustomersPage()}
        {page === "drivers" && DriversPage()}
        {page === "trucks" && TrucksPage()}
        {page === "invoices" && InvoicesPage()}
        {page === "invoicehistory" && InvoiceHistoryPage()}
        {page === "users" && UserManagementPage()}
        {page === "driverpay" && DriverPayPage()}
      </div>

      {printMode === "customer" && <PrintSection title="Customer Invoice" groups={customerInvoices} type="customer" />}
      {printMode === "driver" && <PrintSection title="Driver Pay Sheet" groups={driverPaySheets} type="driver" />}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
