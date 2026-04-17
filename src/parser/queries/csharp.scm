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
