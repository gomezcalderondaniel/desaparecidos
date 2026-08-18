import React, { useState, useEffect, useMemo } from "react";
import { Search, Plus, X, MapPin, Calendar, Phone, CircleCheck, CircleAlert, ExternalLink, ChevronLeft, Image as ImageIcon, HeartPulse, Users } from "lucide-react";
import { supabase } from "./supabaseClient";

const MUNICIPIOS = [
  "Cali", "Pereira", "Quibdó", "Manizales", "San José del Palmar",
  "El Cairo", "Bahía Solano", "Armenia", "Bogotá", "Otro"
];

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("");
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "hace un momento";
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}

// Reads an uploaded image file, downsizes it, and returns a JPEG Blob.
// Keeps uploads small and consistent regardless of the original photo size.
function resizeImageToBlob(file, maxDim = 480, quality = 0.7) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("not-an-image"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read-failed"));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error("decode-failed"));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          blob => (blob ? resolve(blob) : reject(new Error("blob-failed"))),
          "image/jpeg",
          quality
        );
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Resizes then uploads a photo to the "photos" bucket, returning its public URL.
async function uploadPhoto(file) {
  const blob = await resizeImageToBlob(file);
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from("photos").upload(path, blob, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from("photos").getPublicUrl(path);
  return data.publicUrl;
}

// Converts between the app's camelCase records and Supabase's snake_case columns.
function toDb(c) {
  return {
    status: c.status,
    name: c.name,
    age: c.age,
    municipio: c.municipio,
    barrio: c.barrio,
    last_seen_date: c.lastSeenDate,
    description: c.description,
    medical_notes: c.medicalNotes,
    reporter_contact: c.reporterContact,
    relationship: c.relationship,
    photo_url: c.photoUrl,
  };
}

function fromDb(row) {
  return {
    id: row.id,
    status: row.status,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    updates: row.updates || [],
    name: row.name,
    age: row.age,
    municipio: row.municipio,
    barrio: row.barrio,
    lastSeenDate: row.last_seen_date,
    description: row.description,
    medicalNotes: row.medical_notes,
    reporterContact: row.reporter_contact,
    relationship: row.relationship,
    photoUrl: row.photo_url,
  };
}

const STATUS = {
  missing: { label: "Desaparecido", color: "#A13D3D", bg: "#F7EBEA" },
  found: { label: "Encontrado con vida", color: "#2F6B4F", bg: "#EAF3EE" },
  deceased: { label: "Fallecido, confirmado", color: "#4A4A52", bg: "#EDEDEF" },
};

function Avatar({ name, photoUrl, bg, color, size = 42, large = false }) {
  const [failed, setFailed] = useState(false);
  const dim = { width: size, height: size };
  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt={name || "Foto"}
        onError={() => setFailed(true)}
        style={{ ...dim, borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "1px solid #E5E6E1" }}
      />
    );
  }
  return (
    <div style={{
      ...dim, borderRadius: "50%", background: bg, color,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700,
      fontSize: large ? 22 : 15, flexShrink: 0,
    }}>
      {initials(name || "")}
    </div>
  );
}

export default function App() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("missing"); // missing | found | all
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showInfoBanner, setShowInfoBanner] = useState(true);

  useEffect(() => {
    loadCases();

    const channel = supabase
      .channel("reports-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "reports" }, () => {
        loadCases();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function loadCases() {
    const { data, error: err } = await supabase
      .from("reports")
      .select("*")
      .order("updated_at", { ascending: false });
    if (err) {
      setError("No se pudo cargar el tablero. Revisa tu conexión.");
    } else {
      setCases(data.map(fromDb));
      setError(null);
    }
    setLoading(false);
  }

  async function addCase(entry) {
    const { data, error: err } = await supabase
      .from("reports")
      .insert(toDb({ status: "missing", ...entry }))
      .select()
      .single();
    if (err) {
      setError("No se pudo guardar el reporte. Intenta de nuevo.");
      return;
    }
    const record = fromDb(data);
    setCases(prev => [record, ...prev]);
    setShowForm(false);
    setSelected(record);
  }

  async function updateStatus(id, status, note, contact) {
    const current = cases.find(c => c.id === id);
    const entry = { status, note: note || "", contact: contact || "", ts: Date.now() };
    const nextUpdates = [entry, ...(current?.updates || [])];
    const { data, error: err } = await supabase
      .from("reports")
      .update({ status, updated_at: new Date().toISOString(), updates: nextUpdates })
      .eq("id", id)
      .select()
      .single();
    if (err) {
      setError("No se pudo guardar la actualización. Intenta de nuevo.");
      return;
    }
    const updated = fromDb(data);
    setCases(prev => prev.map(c => (c.id === id ? updated : c)));
    setSelected(updated);
  }

  const filtered = useMemo(() => {
    let list = cases;
    if (tab !== "all") list = list.filter(c => (tab === "found" ? c.status !== "missing" : c.status === "missing"));
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(c =>
        c.name?.toLowerCase().includes(q) ||
        c.municipio?.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [cases, tab, query]);

  const counts = useMemo(() => ({
    missing: cases.filter(c => c.status === "missing").length,
    found: cases.filter(c => c.status !== "missing").length,
    total: cases.length,
  }), [cases]);

  return (
    <div style={styles.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body { margin: 0; }
        button { font-family: inherit; cursor: pointer; }
        input, textarea, select { font-family: inherit; }
        ::placeholder { color: #9A9D97; }
        .card:active { transform: scale(0.99); }
        button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible {
          outline: 2px solid #E3A008; outline-offset: 2px;
        }
        @media (prefers-reduced-motion: reduce) {
          * { transition: none !important; animation: none !important; }
        }
      `}</style>

      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerTop}>
          <div>
            <div style={styles.eyebrow}>REGISTRO COMUNITARIO · TERREMOTO COLOMBIA, AGO 2026</div>
            <h1 style={styles.title}>Buscando y Encontrados</h1>
          </div>
        </div>
        <div style={styles.ticker}>
          <span style={{ color: STATUS.missing.color }}>{counts.missing} buscando</span>
          <span style={styles.tickerDot}>·</span>
          <span style={{ color: STATUS.found.color }}>{counts.found} con actualización</span>
          <span style={styles.tickerDot}>·</span>
          <span>{counts.total} en total</span>
        </div>
      </header>

      {showInfoBanner && (
        <div style={styles.banner}>
          <div style={{ flex: 1 }}>
            <strong>Antes de reportar aquí:</strong> usa los canales oficiales primero — llegan a más gente.
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
              <a href="https://colombiatebusca.com/" target="_blank" rel="noopener noreferrer" style={styles.bannerLink}>
                Colombia Te Busca <ExternalLink size={12} />
              </a>
              <a href="https://wa.me/573212139525" target="_blank" rel="noopener noreferrer" style={styles.bannerLink}>
                Cruz Roja Colombiana (WhatsApp +57 321 213 9525) <ExternalLink size={12} />
              </a>
            </div>
          </div>
          <button aria-label="Cerrar aviso" onClick={() => setShowInfoBanner(false)} style={styles.bannerClose}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* Search + tabs */}
      <div style={styles.controls}>
        <div style={styles.searchBar}>
          <Search size={16} color="#7A7D76" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por nombre o municipio…"
            style={styles.searchInput}
          />
        </div>
        <div style={styles.tabs}>
          {[["missing", `Buscando (${counts.missing})`], ["found", `Actualizados (${counts.found})`], ["all", "Todos"]].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{ ...styles.tab, ...(tab === key ? styles.tabActive : {}) }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <main style={styles.list}>
        {loading && <div style={styles.emptyState}>Cargando registros…</div>}
        {!loading && filtered.length === 0 && (
          <div style={styles.emptyState}>
            {query ? "Nadie coincide con esa búsqueda." : "Todavía no hay reportes en esta pestaña."}
          </div>
        )}
        {!loading && filtered.map(c => {
          const s = STATUS[c.status] || STATUS.missing;
          return (
            <button key={c.id} className="card" onClick={() => setSelected(c)} style={{ ...styles.card, borderLeftColor: s.color }}>
              <Avatar name={c.name} photoUrl={c.photoUrl} bg={s.bg} color={s.color} size={42} />
              <div style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
                <div style={styles.cardName}>{c.name}{c.age ? `, ${c.age}` : ""}</div>
                <div style={styles.cardMeta}>
                  <MapPin size={12} /> {c.municipio}{c.barrio ? ` · ${c.barrio}` : ""}
                </div>
                <div style={styles.cardTime}>Actualizado {timeAgo(c.updatedAt)}</div>
              </div>
              <span style={{ ...styles.statusPill, color: s.color, background: s.bg }}>{s.label}</span>
            </button>
          );
        })}
      </main>

      {/* FAB */}
      <button style={styles.fab} onClick={() => setShowForm(true)} aria-label="Reportar persona">
        <Plus size={22} color="#1B2A22" />
      </button>

      {/* Detail modal */}
      {selected && (
        <DetailModal
          record={selected}
          onClose={() => setSelected(null)}
          onUpdateStatus={updateStatus}
        />
      )}

      {/* Form modal */}
      {showForm && (
        <ReportForm onClose={() => setShowForm(false)} onSubmit={addCase} />
      )}

      {error && <div style={styles.errorToast}>{error}</div>}
    </div>
  );
}

function DetailModal({ record, onClose, onUpdateStatus }) {
  const [note, setNote] = useState("");
  const [contact, setContact] = useState("");
  const [pendingStatus, setPendingStatus] = useState(null);
  const s = STATUS[record.status] || STATUS.missing;

  function submitUpdate(status) {
    onUpdateStatus(record.id, status, note, contact);
    setNote("");
    setContact("");
    setPendingStatus(null);
  }

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalSheet} onClick={e => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <button onClick={onClose} style={styles.iconBtn} aria-label="Volver"><ChevronLeft size={20} /></button>
          <span style={{ ...styles.statusPill, color: s.color, background: s.bg }}>{s.label}</span>
        </div>

        <Avatar name={record.name} photoUrl={record.photoUrl} bg={s.bg} color={s.color} size={64} large />
        <h2 style={styles.detailName}>{record.name}{record.age ? `, ${record.age} años` : ""}</h2>

        <div style={styles.detailRow}><MapPin size={14} /> {record.municipio}{record.barrio ? `, ${record.barrio}` : ""}</div>
        {record.lastSeenDate && <div style={styles.detailRow}><Calendar size={14} /> Visto por última vez: {record.lastSeenDate}</div>}
        {record.relationship && <div style={styles.detailRow}><Users size={14} /> Reportado por: {record.relationship}</div>}
        {record.reporterContact && <div style={styles.detailRow}><Phone size={14} /> Contacto de quien reporta: {record.reporterContact}</div>}
        {record.medicalNotes && <div style={styles.detailRow}><HeartPulse size={14} /> Condición médica: {record.medicalNotes}</div>}

        {record.description && (
          <div style={styles.detailBlock}>
            <div style={styles.detailLabel}>Descripción</div>
            <p style={styles.detailText}>{record.description}</p>
          </div>
        )}

        {record.updates?.length > 0 && (
          <div style={styles.detailBlock}>
            <div style={styles.detailLabel}>Historial de actualizaciones</div>
            {record.updates.map((u, i) => (
              <div key={i} style={styles.updateRow}>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#7A7D76" }}>
                  {new Date(u.ts).toLocaleString("es-CO")}
                </div>
                <div style={{ fontWeight: 600, color: STATUS[u.status]?.color }}>{STATUS[u.status]?.label}</div>
                {u.note && <div style={{ fontSize: 13.5, color: "#3A3D37" }}>{u.note}</div>}
                {u.contact && <div style={{ fontSize: 12.5, color: "#7A7D76" }}>Reportado por: {u.contact}</div>}
              </div>
            ))}
          </div>
        )}

        <div style={styles.detailBlock}>
          <div style={styles.detailLabel}>¿Tienes información nueva?</div>
          {!pendingStatus ? (
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button style={{ ...styles.actionBtn, background: STATUS.found.bg, color: STATUS.found.color }} onClick={() => setPendingStatus("found")}>
                <CircleCheck size={15} /> Marcar encontrado
              </button>
              <button style={{ ...styles.actionBtn, background: STATUS.deceased.bg, color: STATUS.deceased.color }} onClick={() => setPendingStatus("deceased")}>
                <CircleAlert size={15} /> Confirmar fallecido
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              <textarea
                placeholder="¿Dónde y cómo? (opcional, pero ayuda mucho)"
                value={note}
                onChange={e => setNote(e.target.value)}
                style={styles.textarea}
                rows={3}
              />
              <input
                placeholder="Tu nombre o contacto (opcional)"
                value={contact}
                onChange={e => setContact(e.target.value)}
                style={styles.input}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button style={styles.submitBtn} onClick={() => submitUpdate(pendingStatus)}>Confirmar actualización</button>
                <button style={styles.cancelBtn} onClick={() => setPendingStatus(null)}>Cancelar</button>
              </div>
            </div>
          )}
        </div>

        <p style={styles.footnote}>
          Recuerda también reportar esta información a la Cruz Roja Colombiana o Colombia Te Busca para que llegue a las autoridades.
        </p>
      </div>
    </div>
  );
}

function ReportForm({ onClose, onSubmit }) {
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [municipio, setMunicipio] = useState(MUNICIPIOS[0]);
  const [barrio, setBarrio] = useState("");
  const [lastSeenDate, setLastSeenDate] = useState("");
  const [description, setDescription] = useState("");
  const [medicalNotes, setMedicalNotes] = useState("");
  const [reporterContact, setReporterContact] = useState("");
  const [relationship, setRelationship] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoError, setPhotoError] = useState(false);
  const [photoSource, setPhotoSource] = useState(null); // "upload" | "link" | null
  const [uploading, setUploading] = useState(false);
  const [touched, setTouched] = useState(false);

  const valid = name.trim().length > 1 && municipio;

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setPhotoError(false);
    try {
      const url = await uploadPhoto(file);
      setPhotoUrl(url);
      setPhotoSource("upload");
    } catch (err) {
      setPhotoError(true);
    } finally {
      setUploading(false);
    }
  }

  function clearPhoto() {
    setPhotoUrl("");
    setPhotoSource(null);
    setPhotoError(false);
  }

  function handleSubmit() {
    setTouched(true);
    if (!valid) return;
    onSubmit({
      name: name.trim(),
      age: age.trim(),
      municipio,
      barrio: barrio.trim(),
      lastSeenDate,
      description: description.trim(),
      medicalNotes: medicalNotes.trim(),
      reporterContact: reporterContact.trim(),
      relationship: relationship.trim(),
      photoUrl: photoUrl.trim(),
    });
  }

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalSheet} onClick={e => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <button onClick={onClose} style={styles.iconBtn} aria-label="Cerrar"><X size={20} /></button>
          <div style={styles.formTitle}>Reportar persona desaparecida</div>
        </div>

        <label style={styles.label}>Nombre completo *</label>
        <input style={styles.input} value={name} onChange={e => setName(e.target.value)} placeholder="Ej. María Fernanda Ríos" />
        {touched && !name.trim() && <div style={styles.fieldError}>Este campo es obligatorio.</div>}

        <label style={styles.label}><ImageIcon size={12} style={{ verticalAlign: -1 }} /> Foto</label>

        {!photoUrl && (
          <div style={{ display: "flex", gap: 8 }}>
            <label style={styles.uploadBtn}>
              {uploading ? "Cargando…" : "Subir desde el dispositivo"}
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                style={{ display: "none" }}
                disabled={uploading}
              />
            </label>
          </div>
        )}

        {photoUrl && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
            {!photoError ? (
              <img
                src={photoUrl}
                alt="Vista previa"
                onError={() => setPhotoError(true)}
                style={{ width: 72, height: 72, borderRadius: 10, objectFit: "cover", border: "1px solid #D8DAD3" }}
              />
            ) : (
              <div style={styles.fieldError}>No se pudo cargar esa imagen.</div>
            )}
            <button type="button" onClick={clearPhoto} style={styles.removePhotoBtn}>Quitar foto</button>
          </div>
        )}

        {!photoUrl && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11.5, color: "#9A9D97", marginBottom: 4 }}>
              O, si ya tienes la foto subida en otro lugar, pega el enlace:
            </div>
            <input
              style={styles.input}
              value={photoSource === "link" ? photoUrl : ""}
              onChange={e => { setPhotoUrl(e.target.value); setPhotoSource("link"); setPhotoError(false); }}
              placeholder="https://…"
              inputMode="url"
            />
          </div>
        )}

        <div style={{ fontSize: 11, color: "#9A9D97", marginTop: 4 }}>
          La foto se guarda junto con el reporte y queda visible para cualquiera que use esta app.
        </div>

        <label style={styles.label}>Edad (aprox.)</label>
        <input style={styles.input} value={age} onChange={e => setAge(e.target.value)} placeholder="Ej. 34" inputMode="numeric" />

        <label style={styles.label}>Municipio *</label>
        <select style={styles.input} value={municipio} onChange={e => setMunicipio(e.target.value)}>
          {MUNICIPIOS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        <label style={styles.label}>Barrio o vereda</label>
        <input style={styles.input} value={barrio} onChange={e => setBarrio(e.target.value)} placeholder="Opcional" />

        <label style={styles.label}>Visto por última vez (fecha/hora)</label>
        <input style={styles.input} value={lastSeenDate} onChange={e => setLastSeenDate(e.target.value)} placeholder="Ej. lunes 10 de agosto, en la mañana" />

        <label style={styles.label}>Descripción</label>
        <textarea style={styles.textarea} rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Ropa, señas particulares, circunstancias…" />

        <label style={styles.label}><HeartPulse size={12} style={{ verticalAlign: -1 }} /> Condición médica relevante</label>
        <input style={styles.input} value={medicalNotes} onChange={e => setMedicalNotes(e.target.value)} placeholder="Ej. diabética, necesita insulina (opcional)" />

        <label style={styles.label}><Users size={12} style={{ verticalAlign: -1 }} /> Tu relación con esta persona</label>
        <input style={styles.input} value={relationship} onChange={e => setRelationship(e.target.value)} placeholder="Ej. hija, vecino, amigo (opcional)" />

        <label style={styles.label}>Tu contacto (para que te puedan avisar)</label>
        <input style={styles.input} value={reporterContact} onChange={e => setReporterContact(e.target.value)} placeholder="Teléfono o WhatsApp" />

        <button style={{ ...styles.submitBtn, marginTop: 16, opacity: valid ? 1 : 0.5 }} onClick={handleSubmit}>
          Publicar reporte
        </button>
        <p style={styles.footnote}>
          Este reporte quedará visible para cualquiera que use esta app. No incluyas información que no quieras hacer pública.
        </p>
      </div>
    </div>
  );
}

const styles = {
  app: {
    fontFamily: "'IBM Plex Sans', sans-serif",
    background: "#F5F6F4",
    color: "#1B2A22",
    minHeight: "100vh",
    maxWidth: 480,
    margin: "0 auto",
    paddingBottom: 100,
    position: "relative",
  },
  header: { padding: "20px 18px 12px" },
  headerTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  eyebrow: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10.5,
    letterSpacing: "0.06em",
    color: "#A13D3D",
    fontWeight: 500,
  },
  title: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 26,
    fontWeight: 700,
    margin: "4px 0 0",
    letterSpacing: "-0.01em",
  },
  ticker: {
    marginTop: 10,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12.5,
    color: "#4A4A52",
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
  },
  tickerDot: { color: "#C7C9C2" },
  banner: {
    margin: "0 18px 14px",
    background: "#FDF6E3",
    border: "1px solid #F0DDA0",
    borderRadius: 12,
    padding: "12px 14px",
    fontSize: 13,
    lineHeight: 1.5,
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
  },
  bannerLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    color: "#8A6200",
    fontWeight: 600,
    textDecoration: "none",
  },
  bannerClose: {
    background: "none",
    border: "none",
    color: "#8A6200",
    padding: 2,
    flexShrink: 0,
  },
  controls: { padding: "0 18px", position: "sticky", top: 0, background: "#F5F6F4", zIndex: 5, paddingBottom: 10 },
  searchBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#FFFFFF",
    border: "1px solid #D8DAD3",
    borderRadius: 10,
    padding: "10px 12px",
  },
  searchInput: { border: "none", outline: "none", flex: 1, fontSize: 14.5, background: "transparent", color: "#1B2A22" },
  tabs: { display: "flex", gap: 6, marginTop: 10 },
  tab: {
    flex: 1,
    border: "1px solid #D8DAD3",
    background: "#FFFFFF",
    borderRadius: 8,
    padding: "8px 6px",
    fontSize: 12.5,
    fontWeight: 500,
    color: "#4A4A52",
  },
  tabActive: { background: "#1B2A22", color: "#FFFFFF", borderColor: "#1B2A22" },
  list: { padding: "4px 18px", display: "flex", flexDirection: "column", gap: 10 },
  emptyState: { textAlign: "center", color: "#7A7D76", fontSize: 14, padding: "40px 20px" },
  card: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    background: "#FFFFFF",
    border: "1px solid #E5E6E1",
    borderLeft: "4px solid",
    borderRadius: 10,
    padding: "12px 14px",
    textAlign: "left",
    width: "100%",
  },
  avatar: {
    width: 42, height: 42, borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 15, flexShrink: 0,
  },
  cardName: { fontWeight: 600, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  cardMeta: { fontSize: 12.5, color: "#7A7D76", display: "flex", alignItems: "center", gap: 4, marginTop: 2 },
  cardTime: { fontSize: 11, color: "#A5A79F", marginTop: 3, fontFamily: "'IBM Plex Mono', monospace" },
  statusPill: { fontSize: 10.5, fontWeight: 600, padding: "4px 8px", borderRadius: 999, whiteSpace: "nowrap", flexShrink: 0 },
  fab: {
    position: "fixed",
    bottom: 24,
    left: "50%",
    transform: "translateX(90px)",
    width: 54, height: 54, borderRadius: "50%",
    background: "#E3A008",
    border: "none",
    boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  modalOverlay: {
    position: "fixed", inset: 0, background: "rgba(27,42,34,0.4)",
    display: "flex", alignItems: "flex-end", zIndex: 20,
  },
  modalSheet: {
    background: "#F5F6F4", width: "100%", maxWidth: 480, margin: "0 auto",
    maxHeight: "90vh", overflowY: "auto",
    borderRadius: "16px 16px 0 0", padding: "16px 18px 28px",
  },
  modalHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  iconBtn: { background: "#FFFFFF", border: "1px solid #E5E6E1", borderRadius: 8, padding: 6, display: "flex" },
  formTitle: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16 },
  avatarLg: {
    width: 64, height: 64, borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 22, margin: "6px 0",
  },
  detailName: { fontFamily: "'Space Grotesk', sans-serif", fontSize: 21, margin: "0 0 10px" },
  detailRow: { display: "flex", alignItems: "center", gap: 6, fontSize: 13.5, color: "#3A3D37", marginBottom: 6 },
  detailBlock: { marginTop: 18, borderTop: "1px solid #E5E6E1", paddingTop: 14 },
  detailLabel: { fontSize: 11.5, fontWeight: 600, color: "#7A7D76", letterSpacing: "0.03em", textTransform: "uppercase" },
  detailText: { fontSize: 14, lineHeight: 1.5, marginTop: 6 },
  updateRow: { marginTop: 10, paddingLeft: 10, borderLeft: "2px solid #E5E6E1" },
  actionBtn: {
    flex: 1, border: "none", borderRadius: 9, padding: "10px 8px",
    fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
  },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#4A4A52", marginTop: 14, marginBottom: 6 },
  input: {
    width: "100%", border: "1px solid #D8DAD3", borderRadius: 8, padding: "10px 12px",
    fontSize: 14.5, background: "#FFFFFF", color: "#1B2A22",
  },
  textarea: {
    width: "100%", border: "1px solid #D8DAD3", borderRadius: 8, padding: "10px 12px",
    fontSize: 14.5, background: "#FFFFFF", color: "#1B2A22", resize: "vertical",
  },
  fieldError: { color: "#A13D3D", fontSize: 12, marginTop: 4 },
  uploadBtn: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    background: "#FFFFFF", border: "1px dashed #B7B9B1", borderRadius: 9,
    padding: "12px 14px", fontSize: 13.5, fontWeight: 500, color: "#3A3D37",
    width: "100%", textAlign: "center",
  },
  removePhotoBtn: {
    background: "none", border: "none", color: "#A13D3D", fontSize: 12.5,
    fontWeight: 500, padding: 0, textDecoration: "underline",
  },
  submitBtn: {
    flex: 1, background: "#1B2A22", color: "#FFFFFF", border: "none",
    borderRadius: 9, padding: "12px", fontSize: 14, fontWeight: 600,
  },
  cancelBtn: {
    background: "#FFFFFF", color: "#4A4A52", border: "1px solid #D8DAD3",
    borderRadius: 9, padding: "12px 16px", fontSize: 14, fontWeight: 500,
  },
  footnote: { fontSize: 11.5, color: "#9A9D97", lineHeight: 1.5, marginTop: 16 },
  errorToast: {
    position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)",
    background: "#A13D3D", color: "#fff", padding: "8px 14px", borderRadius: 8, fontSize: 12.5,
  },
};
