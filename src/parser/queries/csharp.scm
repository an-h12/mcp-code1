; C# symbol declarations.
; Captures follow the contract in src/parser/extractor.ts:
;   @name   -> identifier text becomes the symbol name
;   @symbol -> the whole declaration; its node type drives NODE_KIND_TO_SYMBOL_KIND

(class_declaration       name: (identifier) @name) @symbol
(interface_declaration   name: (identifier) @name) @symbol
(struct_declaration      name: (identifier) @name) @symbol
(record_declaration      name: (identifier) @name) @symbol
(enum_declaration        name: (identifier) @name) @symbol
(method_declaration      name: (identifier) @name) @symbol
(constructor_declaration name: (identifier) @name) @symbol
(property_declaration    name: (identifier) @name) @symbol
(delegate_declaration    name: (identifier) @name) @symbol

; namespace can be either a plain identifier or a dotted name (e.g. Foo.Bar.Baz)
(namespace_declaration   name: [(identifier) (qualified_name)] @name) @symbol

; C# 10+ file-scoped namespace: `namespace Foo.Bar;`
(file_scoped_namespace_declaration name: [(identifier) (qualified_name)] @name) @symbol

; event property: `public event EventHandler E { add; remove; }`
(event_declaration name: (identifier) @name) @symbol

; event field: `public event EventHandler Changed;`
(event_field_declaration
  (variable_declaration
    (variable_declarator
      name: (identifier) @name))) @symbol

; indexer: `public int this[int i] { get; set; }` — no name field; extractor
; falls back to the literal "this".
(indexer_declaration) @symbol

; operator overloads: `public static C operator+(C a, C b)` — extractor parses
; the token from the source to form "operator +" / "implicit operator int".
(operator_declaration) @symbol
(conversion_operator_declaration) @symbol

; destructor / finalizer: `~ClassName() { }`
(destructor_declaration name: (identifier) @name) @symbol

; local functions inside a method body: `int Helper() => 1;`
(local_function_statement name: (identifier) @name) @symbol

; record positional parameters: `record Money(decimal Amount, string Currency)`
; become property-like symbols of the record type. Class primary constructors
; (C# 12 `class C(int x)`) are skipped — they are ctor params, not public API.
(record_declaration
  (parameter_list
    (parameter name: (identifier) @name) @symbol.record_param))
