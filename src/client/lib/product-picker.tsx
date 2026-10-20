import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { apiGet } from "./api";
import { useDebounced } from "./hooks";
import type { ProductOption } from "./lookups";
import { Input, Spinner } from "./ui";

/**
 * Seleção de produto com busca aproximada.
 *
 * O estoque tem centenas de itens, então um menu suspenso não escala: o usuário
 * digita parte do nome ou do SKU e a lista filtra a cada letra (a API entende
 * acentos e vários termos em qualquer ordem). Teclado: setas navegam, Enter
 * escolhe e Esc fecha a lista sem fechar o diálogo.
 */

interface ProductPickerProps {
  /** Id do produto selecionado ("" quando vazio). */
  value: string;
  /** Recebe o id e o produto completo (para preencher unidade, por exemplo). */
  onChange: (productId: string, product: ProductOption | null) => void;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Só produtos ativos (padrão). Movimentações aceitam itens desativados. */
  activeOnly?: boolean;
  className?: string;
}

const EMPTY_HINT = "Digite parte do nome ou do SKU — ex.: “agua” encontra Água Sanitária.";

export function ProductPicker({
  value,
  onChange,
  id,
  placeholder = "Buscar produto por nome ou SKU...",
  ariaLabel = "Produto",
  autoFocus,
  disabled,
  activeOnly = true,
  className = "",
}: ProductPickerProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [selected, setSelected] = useState<ProductOption | null>(null);
  const debouncedQuery = useDebounced(query, 250);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);
  const requestSeq = useRef(0);

  // Rótulo do selecionado: quando o valor vem de fora (edição), busca o produto.
  useEffect(() => {
    if (!value) {
      setSelected(null);
      return;
    }
    if (selected?.id === value) return;
    let active = true;
    apiGet<{ product: ProductOption }>(`/api/catalog/products/${value}`)
      .then((result) => {
        if (active) setSelected(result.product);
      })
      .catch(() => {
        // Sem o rótulo a lista continua útil; nada a fazer aqui.
      });
    return () => {
      active = false;
    };
  }, [value, selected?.id]);

  const load = useCallback(
    (term: string) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      apiGet<{ items: ProductOption[] }>("/api/catalog/products", {
        pageSize: 20,
        sort: "name",
        ...(activeOnly ? { isActive: "true" } : {}),
        ...(term ? { search: term } : {}),
      })
        .then((result) => {
          if (seq !== requestSeq.current) return;
          setOptions(result.items);
          setHighlight(0);
        })
        .catch(() => {
          if (seq === requestSeq.current) setOptions([]);
        })
        .finally(() => {
          if (seq === requestSeq.current) setLoading(false);
        });
    },
    [activeOnly],
  );

  useEffect(() => {
    if (!open) return;
    load(debouncedQuery.trim());
  }, [open, debouncedQuery, load]);

  useEffect(() => {
    optionRefs.current[highlight]?.scrollIntoView({ block: "nearest" });
  }, [highlight, options]);

  const close = () => {
    setOpen(false);
    setEditing(false);
    setQuery("");
  };

  const select = (product: ProductOption) => {
    setSelected(product);
    close();
    onChange(product.id, product);
  };

  const clear = () => {
    setSelected(null);
    onChange("", null);
    load("");
  };

  const labelFor = (product: ProductOption) =>
    `${product.name}${product.sku ? ` (${product.sku})` : ""}`;

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlight((current) => Math.min(current + 1, Math.max(options.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      if (open && options[highlight]) {
        event.preventDefault();
        select(options[highlight] as ProductOption);
      }
    } else if (event.key === "Escape") {
      if (open) {
        // Fecha a lista primeiro; o Esc do diálogo fica para o próximo toque.
        event.stopPropagation();
        close();
      }
    } else if (event.key === "Tab") {
      close();
    }
  };

  const text = editing ? query : selected ? labelFor(selected) : "";

  return (
    <div className={`relative ${className}`}>
      <Input
        id={id}
        value={text}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && options[highlight] ? `${listId}-${highlight}` : undefined}
        className={loading || value ? "pr-9" : ""}
        onChange={(event) => {
          setQuery(event.target.value);
          setEditing(true);
          setOpen(true);
        }}
        onFocus={() => {
          if (!disabled) setOpen(true);
        }}
        onBlur={() => close()}
        onKeyDown={handleKeyDown}
      />
      {loading ? (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
          <Spinner className="size-4" />
        </span>
      ) : value && !disabled ? (
        <button
          type="button"
          onClick={clear}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 transition hover:text-slate-600"
          aria-label="Limpar produto selecionado"
        >
          ×
        </button>
      ) : null}

      {open && !disabled ? (
        <div
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-surface py-1 shadow-lg"
        >
          {loading && options.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-500">Buscando produtos...</p>
          ) : options.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-500">
              Nenhum produto encontrado. {EMPTY_HINT}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {options.map((product, index) => (
                <li
                  key={product.id}
                  id={`${listId}-${index}`}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  role="option"
                  aria-selected={index === highlight}
                  onMouseDown={(event) => {
                    // Antes do blur do input: o clique escolhe sem fechar antes.
                    event.preventDefault();
                    select(product);
                  }}
                  onMouseEnter={() => setHighlight(index)}
                  className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm ${
                    index === highlight ? "bg-brand-50 text-brand-900" : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className="min-w-0 truncate">{product.name}</span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {product.sku ? `${product.sku} · ` : ""}
                    {product.uomCode ?? ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
