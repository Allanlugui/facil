import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PERMISSIONS } from "@shared/permissions";
import type { Paginated } from "@shared/types";
import { apiErrorMessage, apiGet, apiPatch, apiPost, fieldErrors } from "../lib/api";
import { formatQuantity, plural } from "../lib/format";
import { useAsync, useDebounced } from "../lib/hooks";
import { useCategories, useSuppliers, useUoms } from "../lib/lookups";
import { useSession } from "../lib/session";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Table,
  Tabs,
  Textarea,
  useToast,
  type Column,
} from "../lib/ui";

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

interface ProductRow {
  id: string;
  sku: string | null;
  name: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  uomId: string;
  uomCode: string | null;
  allowsDecimal: boolean;
  packUomId: string | null;
  packUomCode: string | null;
  packFactor: number;
  minQtyMilli: number;
  defaultSupplierId: string | null;
  supplierName: string | null;
  tracksStock: boolean;
  isActive: boolean;
  catalogStatus: string;
  notes: string | null;
  totalQtyMilli: number;
  stockedLocations: number;
  isBelowMinimum: boolean;
}

interface CategoryRow {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
}

interface UomRow {
  id: string;
  code: string;
  name: string;
  allowsDecimal: boolean;
  isActive: boolean;
  productCount: number;
}

interface SupplierRow {
  id: string;
  name: string;
  doc: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
}

type Tab = "products" | "categories" | "uoms" | "suppliers";

/* -------------------------------------------------------------------------- */
/* Página                                                                     */
/* -------------------------------------------------------------------------- */

export function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab =
    raw === "categories" || raw === "uoms" || raw === "suppliers" ? raw : "products";

  return (
    <div>
      <PageHeader
        title="Catálogo"
        description="Produtos, categorias, unidades de medida e fornecedores usados por todo o sistema."
      />
      <Tabs
        tabs={[
          { value: "products", label: "Produtos" },
          { value: "categories", label: "Categorias" },
          { value: "uoms", label: "Unidades de medida" },
          { value: "suppliers", label: "Fornecedores" },
        ]}
        value={tab}
        onChange={(value) => {
          const next = new URLSearchParams(params);
          next.set("tab", value);
          setParams(next, { replace: true });
        }}
      />
      {tab === "products" ? <ProductsTab /> : null}
      {tab === "categories" ? <CategoriesTab /> : null}
      {tab === "uoms" ? <UomsTab /> : null}
      {tab === "suppliers" ? <SuppliersTab /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Produtos                                                                   */
/* -------------------------------------------------------------------------- */

function ProductsTab() {
  const { can } = useSession();
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const [categoryId, setCategoryId] = useState("");
  const [isActive, setIsActive] = useState("");
  const [page, setPage] = useState(1);
  const [incompleteOnly, setIncompleteOnly] = useState(
    () => new URLSearchParams(window.location.search).get("incomplete") === "true",
  );
  const [editing, setEditing] = useState<ProductRow | "new" | null>(null);
  const categories = useCategories();
  const manage = can(PERMISSIONS.CATALOG_MANAGE);

  const state = useAsync(
    () =>
      apiGet<Paginated<ProductRow>>("/api/catalog/products", {
        search: debounced,
        categoryId: categoryId || undefined,
        isActive: isActive || undefined,
        incomplete: incompleteOnly ? "true" : undefined,
        page,
        pageSize: 25,
      }),
    [debounced, categoryId, isActive, incompleteOnly, page],
  );

  const columns: Column<ProductRow>[] = [
    {
      key: "product",
      header: "Produto",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">{row.name}</p>
          <p className="truncate text-xs text-slate-500">
            {row.sku ? `${row.sku} · ` : ""}
            {row.categoryName ?? "Sem categoria"}
          </p>
          {row.catalogStatus === "incomplete" ? (
            <span className="mt-1 inline-flex">
              <Badge tone="amber">Cadastro incompleto</Badge>
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "uom",
      header: "Unidade",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-slate-600">
          {row.uomCode}
          {row.packUomCode && row.packFactor > 1 ? ` (embalagem: ${row.packUomCode}×${row.packFactor})` : ""}
        </span>
      ),
    },
    {
      key: "min",
      header: "Mínimo",
      align: "right",
      hideOnMobile: true,
      cell: (row) =>
        row.minQtyMilli > 0 ? (
          <span className="tabular-nums">{formatQuantity(row.minQtyMilli)}</span>
        ) : (
          <span className="text-slate-400">-</span>
        ),
    },
    {
      key: "stock",
      header: "Saldo total",
      align: "right",
      cell: (row) =>
        row.tracksStock ? (
          <span
            className={`tabular-nums font-medium ${
              row.isBelowMinimum ? "text-amber-800" : "text-slate-800"
            }`}
          >
            {formatQuantity(row.totalQtyMilli)} {row.uomCode}
          </span>
        ) : (
          <Badge tone="slate">Não controla estoque</Badge>
        ),
    },
    {
      key: "supplier",
      header: "Fornecedor",
      hideOnMobile: true,
      cell: (row) => <span className="text-sm text-slate-600">{row.supplierName ?? "-"}</span>,
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) =>
        row.isActive ? <Badge tone="green">Ativo</Badge> : <Badge tone="slate">Inativo</Badge>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) =>
        manage ? (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
              Editar
            </Button>
            <ToggleActiveButton
              path={`/api/catalog/products/${row.id}`}
              isActive={row.isActive}
              onDone={state.reload}
            />
          </div>
        ) : null,
    },
  ];

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Nome, SKU ou descrição..."
          className="w-full sm:w-72"
        />
        <Select
          value={categoryId}
          onChange={(event) => {
            setCategoryId(event.target.value);
            setPage(1);
          }}
          className="w-full sm:w-56"
          aria-label="Filtrar por categoria"
        >
          <option value="">Todas as categorias</option>
          {(categories.data ?? []).map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
        <Select
          value={isActive}
          onChange={(event) => {
            setIsActive(event.target.value);
            setPage(1);
          }}
          className="w-full sm:w-40"
          aria-label="Filtrar por situação"
        >
          <option value="">Ativos e inativos</option>
          <option value="true">Somente ativos</option>
          <option value="false">Somente inativos</option>
        </Select>
        {manage ? (
          <div className="ml-auto">
            <Button onClick={() => setEditing("new")}>Novo produto</Button>
          </div>
        ) : null}
      </div>

      {incompleteOnly ? (
        <div className="border-b border-amber-100 bg-amber-50/60 px-4 py-2">
          <p className="text-sm text-amber-900">
            Mostrando apenas produtos com cadastro incompleto (criados no recebimento).
            <button
              type="button"
              className="ml-2 font-medium underline"
              onClick={() => {
                setIncompleteOnly(false);
                setPage(1);
              }}
            >
              Ver todos os produtos
            </button>
          </p>
        </div>
      ) : null}

      <div className="p-4">
        {state.loading && !state.data ? (
          <LoadingBlock />
        ) : state.error ? (
          <ErrorBlock message={state.error} onRetry={state.reload} />
        ) : (
          <>
            <Table
              columns={columns}
              rows={state.data?.items ?? []}
              keyOf={(row) => row.id}
              empty={<EmptyState title="Nenhum produto" description="Cadastre o primeiro produto do catálogo." />}
            />
            <div className="mt-3">
              <Pagination
                page={state.data?.page ?? 1}
                pageSize={state.data?.pageSize ?? 25}
                total={state.data?.total ?? 0}
                onPage={setPage}
              />
            </div>
          </>
        )}
      </div>

      {editing ? (
        <ProductDialog
          product={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            state.reload();
          }}
        />
      ) : null}
    </Card>
  );
}

function ProductDialog({
  product,
  onClose,
  onSaved,
}: {
  product: ProductRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const categories = useCategories();
  const uoms = useUoms();
  const suppliers = useSuppliers();
  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const [uomId, setUomId] = useState(product?.uomId ?? "");
  const [minQty, setMinQty] = useState(
    product && product.minQtyMilli > 0 ? formatQuantity(product.minQtyMilli, 3) : "",
  );
  const [supplierId, setSupplierId] = useState(product?.defaultSupplierId ?? "");
  const [tracksStock, setTracksStock] = useState(product?.tracksStock ?? true);
  const [description, setDescription] = useState(product?.description ?? "");
  const [notes, setNotes] = useState(product?.notes ?? "");
  const [catalogStatus, setCatalogStatus] = useState(product?.catalogStatus ?? "complete");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    setError(null);
    setErrors({});
    setSaving(true);
    const payload = {
      name,
      sku: sku || null,
      categoryId: categoryId || null,
      uomId,
      minQty: minQty ? Number(minQty.replace(",", ".")) : 0,
      defaultSupplierId: supplierId || null,
      tracksStock,
      description: description || null,
      notes: notes || null,
      ...(product ? { catalogStatus } : {}),
    };
    try {
      if (product) {
        await apiPatch(`/api/catalog/products/${product.id}`, payload);
        toast.success("Produto atualizado.");
      } else {
        await apiPost("/api/catalog/products", payload);
        toast.success("Produto cadastrado.");
      }
      onSaved();
    } catch (cause) {
      setError(apiErrorMessage(cause));
      setErrors(fieldErrors(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      wide
      title={product ? "Editar produto" : "Novo produto"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}

        {product?.catalogStatus === "incomplete" ? (
          <Alert tone="amber" title="Cadastro incompleto">
            <p>
              Este produto foi criado no recebimento e ainda está sem os dados completos. Preencha o que
              faltar (categoria, SKU, mínimo, fornecedor) e marque abaixo para concluir o cadastro.
            </p>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
                checked={catalogStatus === "complete"}
                onChange={(event) => setCatalogStatus(event.target.checked ? "complete" : "incomplete")}
              />
              Marcar cadastro como completo
            </label>
          </Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" required error={errors.name} htmlFor="productName">
            <Input id="productName" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </Field>
          <Field
            label="Código (SKU)"
            error={errors.sku}
            hint="Identificador interno; não pode repetir."
            htmlFor="productSku"
          >
            <Input id="productSku" value={sku} onChange={(event) => setSku(event.target.value)} />
          </Field>
          <Field label="Categoria" htmlFor="productCategory">
            <Select
              id="productCategory"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">Sem categoria</option>
              {(categories.data ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Unidade de medida"
            required
            error={errors.uomId}
            hint="Não pode ser trocada depois que o produto tiver saldo."
            htmlFor="productUom"
          >
            <Select id="productUom" value={uomId} onChange={(event) => setUomId(event.target.value)}>
              <option value="">Selecione...</option>
              {(uoms.data ?? [])
                .filter((uom) => uom.isActive)
                .map((uom) => (
                  <option key={uom.id} value={uom.id}>
                    {uom.code} · {uom.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field
            label="Estoque mínimo"
            error={errors.minQty}
            hint="Abaixo deste saldo total o produto aparece nos alertas."
            htmlFor="productMin"
          >
            <Input
              id="productMin"
              value={minQty}
              onChange={(event) => setMinQty(event.target.value)}
              inputMode="decimal"
              placeholder="0"
            />
          </Field>
          <Field label="Fornecedor padrão" htmlFor="productSupplier">
            <Select id="productSupplier" value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
              <option value="">Sem fornecedor padrão</option>
              {(suppliers.data ?? [])
                .filter((supplier) => supplier.isActive)
                .map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>

        <Checkbox
          label="Controla estoque"
          hint="Desmarque para itens de serviço ou uso direto que não passam pelo estoque."
          checked={tracksStock}
          onChange={setTracksStock}
        />

        <Field label="Descrição" htmlFor="productDescription">
          <Textarea
            id="productDescription"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <Field label="Observações internas" htmlFor="productNotes">
          <Textarea id="productNotes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Categorias                                                                 */
/* -------------------------------------------------------------------------- */

function CategoriesTab() {
  const { can } = useSession();
  const toast = useToast();
  const [editing, setEditing] = useState<CategoryRow | "new" | null>(null);
  const state = useAsync(async () => {
    const result = await apiGet<{ items: CategoryRow[] }>("/api/catalog/categories");
    return result.items;
  }, []);
  const manage = can(PERMISSIONS.CATALOG_MANAGE);

  const toggle = async (row: CategoryRow) => {
    try {
      await apiPatch(`/api/catalog/categories/${row.id}`, { isActive: !row.isActive });
      toast.success(row.isActive ? "Categoria desativada." : "Categoria reativada.");
      state.reload();
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    }
  };

  const columns: Column<CategoryRow>[] = [
    {
      key: "name",
      header: "Categoria",
      cell: (row) => (
        <div>
          <p className="font-medium text-slate-800">{row.name}</p>
          {row.description ? <p className="text-xs text-slate-500">{row.description}</p> : null}
        </div>
      ),
    },
    {
      key: "parent",
      header: "Categoria pai",
      hideOnMobile: true,
      cell: (row) => <span className="text-sm text-slate-600">{row.parentName ?? "-"}</span>,
    },
    {
      key: "products",
      header: "Produtos",
      align: "right",
      cell: (row) => <span className="tabular-nums text-slate-600">{row.productCount}</span>,
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => (row.isActive ? <Badge tone="green">Ativa</Badge> : <Badge tone="slate">Inativa</Badge>),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) =>
        manage ? (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
              Editar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void toggle(row)}>
              {row.isActive ? "Desativar" : "Reativar"}
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <Card padded={false}>
      <div className="flex items-center justify-between border-b border-slate-100 p-4">
        <p className="text-sm text-slate-600">{state.data?.length ?? 0} {plural(state.data?.length ?? 0, "categoria cadastrada", "categorias cadastradas")}.</p>
        {manage ? <Button onClick={() => setEditing("new")}>Nova categoria</Button> : null}
      </div>
      <div className="p-4">
        {state.loading && !state.data ? (
          <LoadingBlock />
        ) : state.error ? (
          <ErrorBlock message={state.error} onRetry={state.reload} />
        ) : (
          <Table
            columns={columns}
            rows={state.data ?? []}
            keyOf={(row) => row.id}
            empty={<EmptyState title="Nenhuma categoria" description="Categorias agrupam produtos nos relatórios." />}
          />
        )}
      </div>
      {editing ? (
        <CategoryDialog
          category={editing === "new" ? null : editing}
          categories={state.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            state.reload();
          }}
        />
      ) : null}
    </Card>
  );
}

function CategoryDialog({
  category,
  categories,
  onClose,
  onSaved,
}: {
  category: CategoryRow | null;
  categories: CategoryRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(category?.name ?? "");
  const [parentId, setParentId] = useState(category?.parentId ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [sortOrder, setSortOrder] = useState(String(category?.sortOrder ?? 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    const payload = {
      name,
      parentId: parentId || null,
      description: description || null,
      sortOrder: Number(sortOrder) || 0,
    };
    try {
      if (category) {
        await apiPatch(`/api/catalog/categories/${category.id}`, payload);
        toast.success("Categoria atualizada.");
      } else {
        await apiPost("/api/catalog/categories", payload);
        toast.success("Categoria criada.");
      }
      onSaved();
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      title={category ? "Editar categoria" : "Nova categoria"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <Field label="Nome" required htmlFor="categoryName">
          <Input id="categoryName" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </Field>
        <Field label="Categoria pai" hint="Deixe vazio para uma categoria raiz." htmlFor="categoryParent">
          <Select id="categoryParent" value={parentId} onChange={(event) => setParentId(event.target.value)}>
            <option value="">Nenhuma</option>
            {categories
              .filter((entry) => entry.id !== category?.id)
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Ordem de exibição" htmlFor="categoryOrder">
          <Input
            id="categoryOrder"
            type="number"
            min={0}
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value)}
          />
        </Field>
        <Field label="Descrição" htmlFor="categoryDescription">
          <Textarea
            id="categoryDescription"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Unidades de medida                                                         */
/* -------------------------------------------------------------------------- */

function UomsTab() {
  const { can } = useSession();
  const toast = useToast();
  const [editing, setEditing] = useState<UomRow | "new" | null>(null);
  const state = useAsync(async () => {
    const result = await apiGet<{ items: UomRow[] }>("/api/catalog/uoms");
    return result.items;
  }, []);
  const manage = can(PERMISSIONS.CATALOG_MANAGE);

  const toggle = async (row: UomRow) => {
    try {
      await apiPatch(`/api/catalog/uoms/${row.id}`, { isActive: !row.isActive });
      toast.success(row.isActive ? "Unidade desativada." : "Unidade reativada.");
      state.reload();
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    }
  };

  const columns: Column<UomRow>[] = [
    { key: "code", header: "Sigla", cell: (row) => <span className="font-medium text-slate-800">{row.code}</span> },
    { key: "name", header: "Nome", cell: (row) => <span className="text-slate-700">{row.name}</span> },
    {
      key: "decimal",
      header: "Aceita decimais",
      hideOnMobile: true,
      cell: (row) =>
        row.allowsDecimal ? <Badge tone="blue">Sim</Badge> : <Badge tone="slate">Somente inteiros</Badge>,
    },
    {
      key: "products",
      header: "Produtos",
      align: "right",
      cell: (row) => <span className="tabular-nums text-slate-600">{row.productCount}</span>,
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => (row.isActive ? <Badge tone="green">Ativa</Badge> : <Badge tone="slate">Inativa</Badge>),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) =>
        manage ? (
          <div className="flex items-center justify-end gap-1">
            {!row.isActive ? (
              <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
                Editar
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => void toggle(row)}>
              {row.isActive ? "Desativar" : "Reativar"}
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <Card padded={false}>
      <div className="flex items-center justify-between border-b border-slate-100 p-4">
        <p className="text-sm text-slate-600">
          A sigla é imutável depois de criada para não corromper lançamentos antigos.
        </p>
        {manage ? <Button onClick={() => setEditing("new")}>Nova unidade</Button> : null}
      </div>
      <div className="p-4">
        {state.loading && !state.data ? (
          <LoadingBlock />
        ) : state.error ? (
          <ErrorBlock message={state.error} onRetry={state.reload} />
        ) : (
          <Table
            columns={columns}
            rows={state.data ?? []}
            keyOf={(row) => row.id}
            empty={<EmptyState title="Nenhuma unidade" description="Cadastre as unidades usadas no estoque." />}
          />
        )}
      </div>
      {editing ? (
        <UomDialog
          uom={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            state.reload();
          }}
        />
      ) : null}
    </Card>
  );
}

function UomDialog({ uom, onClose, onSaved }: { uom: UomRow | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState(uom?.code ?? "");
  const [name, setName] = useState(uom?.name ?? "");
  const [allowsDecimal, setAllowsDecimal] = useState(uom?.allowsDecimal ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      if (uom) {
        await apiPatch(`/api/catalog/uoms/${uom.id}`, { name, allowsDecimal });
        toast.success("Unidade atualizada.");
      } else {
        await apiPost("/api/catalog/uoms", { code, name, allowsDecimal });
        toast.success("Unidade criada.");
      }
      onSaved();
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      title={uom ? "Editar unidade" : "Nova unidade de medida"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <Field
          label="Sigla"
          required
          hint="Até 10 caracteres alfanuméricos, sem espaços. Ex.: UN, CX, LT."
          htmlFor="uomCode"
        >
          <Input
            id="uomCode"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            disabled={Boolean(uom)}
            autoFocus={!uom}
          />
        </Field>
        <Field label="Nome" required htmlFor="uomName">
          <Input id="uomName" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Checkbox
          label="Aceita quantidades decimais"
          hint="Desmarque para unidades contadas apenas em números inteiros."
          checked={allowsDecimal}
          onChange={setAllowsDecimal}
        />
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Fornecedores                                                               */
/* -------------------------------------------------------------------------- */

function SuppliersTab() {
  const { can } = useSession();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const [editing, setEditing] = useState<SupplierRow | "new" | null>(null);
  const manage = can(PERMISSIONS.CATALOG_MANAGE);

  const state = useAsync(async () => {
    const result = await apiGet<{ items: SupplierRow[] }>("/api/catalog/suppliers", { search: debounced });
    return result.items;
  }, [debounced]);

  const toggle = async (row: SupplierRow) => {
    try {
      await apiPatch(`/api/catalog/suppliers/${row.id}`, { isActive: !row.isActive });
      toast.success(row.isActive ? "Fornecedor desativado." : "Fornecedor reativado.");
      state.reload();
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    }
  };

  const columns: Column<SupplierRow>[] = [
    {
      key: "name",
      header: "Fornecedor",
      cell: (row) => (
        <div>
          <p className="font-medium text-slate-800">{row.name}</p>
          {row.doc ? <p className="text-xs text-slate-500">CNPJ/CPF: {row.doc}</p> : null}
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contato",
      hideOnMobile: true,
      cell: (row) => (
        <div className="text-xs">
          <p className="text-slate-700">{row.contactName ?? "-"}</p>
          <p className="text-slate-500">{row.phone ?? ""}</p>
        </div>
      ),
    },
    {
      key: "email",
      header: "E-mail",
      hideOnMobile: true,
      cell: (row) => <span className="text-sm text-slate-600">{row.email ?? "-"}</span>,
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => (row.isActive ? <Badge tone="green">Ativo</Badge> : <Badge tone="slate">Inativo</Badge>),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) =>
        manage ? (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
              Editar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void toggle(row)}>
              {row.isActive ? "Desativar" : "Reativar"}
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Nome ou documento..." className="w-full sm:w-72" />
        {manage ? (
          <div className="ml-auto">
            <Button onClick={() => setEditing("new")}>Novo fornecedor</Button>
          </div>
        ) : null}
      </div>
      <div className="p-4">
        {state.loading && !state.data ? (
          <LoadingBlock />
        ) : state.error ? (
          <ErrorBlock message={state.error} onRetry={state.reload} />
        ) : (
          <Table
            columns={columns}
            rows={state.data ?? []}
            keyOf={(row) => row.id}
            empty={<EmptyState title="Nenhum fornecedor" description="Cadastre fornecedores para vincular as compras." />}
          />
        )}
      </div>
      {editing ? (
        <SupplierDialog
          supplier={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            state.reload();
          }}
        />
      ) : null}
    </Card>
  );
}

function SupplierDialog({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: SupplierRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(supplier?.name ?? "");
  const [doc, setDoc] = useState(supplier?.doc ?? "");
  const [contactName, setContactName] = useState(supplier?.contactName ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [email, setEmail] = useState(supplier?.email ?? "");
  const [notes, setNotes] = useState(supplier?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    const payload = {
      name,
      doc: doc || null,
      contactName: contactName || null,
      phone: phone || null,
      email: email || null,
      notes: notes || null,
    };
    try {
      if (supplier) {
        await apiPatch(`/api/catalog/suppliers/${supplier.id}`, payload);
        toast.success("Fornecedor atualizado.");
      } else {
        await apiPost("/api/catalog/suppliers", payload);
        toast.success("Fornecedor cadastrado.");
      }
      onSaved();
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      title={supplier ? "Editar fornecedor" : "Novo fornecedor"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <Field label="Nome" required htmlFor="supplierName">
          <Input id="supplierName" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="CNPJ / CPF" htmlFor="supplierDoc">
            <Input id="supplierDoc" value={doc} onChange={(event) => setDoc(event.target.value)} />
          </Field>
          <Field label="Pessoa de contato" htmlFor="supplierContact">
            <Input
              id="supplierContact"
              value={contactName}
              onChange={(event) => setContactName(event.target.value)}
            />
          </Field>
          <Field label="Telefone" htmlFor="supplierPhone">
            <Input id="supplierPhone" value={phone} onChange={(event) => setPhone(event.target.value)} />
          </Field>
          <Field label="E-mail" htmlFor="supplierEmail">
            <Input
              id="supplierEmail"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Observações" htmlFor="supplierNotes">
          <Textarea id="supplierNotes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Auxiliares                                                                 */
/* -------------------------------------------------------------------------- */

function ToggleActiveButton({
  path,
  isActive,
  onDone,
}: {
  path: string;
  isActive: boolean;
  onDone: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const toggle = async () => {
    setSaving(true);
    try {
      await apiPatch(path, { isActive: !isActive });
      toast.success(isActive ? "Produto desativado." : "Produto reativado.");
      onDone();
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Button variant="ghost" size="sm" onClick={() => void toggle()} loading={saving}>
      {isActive ? "Desativar" : "Reativar"}
    </Button>
  );
}
