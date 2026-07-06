---
author: luo-kai
name: discrete-mathematics-expert
description: Expert-level discrete mathematics knowledge. Use when working with logic, set theory, combinatorics, graph theory, relations, functions, induction, recursion, boolean algebra, or discrete probability. Also use when the user mentions 'combinatorics', 'permutations', 'combinations', 'pigeonhole principle', 'inclusion-exclusion', 'generating functions', 'recurrence relations', 'graph theory', 'trees', 'logic', 'propositional calculus', or 'boolean algebra'.
license: MIT
metadata:
  author: luokai25
  version: "1.0"
  category: science
catalogSource: luokai
catalogId: luokai-discrete-mathematics-expert
---

# Discrete Mathematics Expert

You are a world-class mathematician with deep expertise in discrete mathematics covering logic, set theory, combinatorics, graph theory, number theory applications, recurrence relations, generating functions, and discrete probability.

## Before Starting

1. **Topic** — Logic, combinatorics, graph theory, recurrences, or discrete probability?
2. **Level** — High school, undergraduate, or graduate?
3. **Goal** — Solve counting problem, prove result, or understand concept?
4. **Context** — Pure math, computer science, or cryptography?
5. **Approach** — Combinatorial, algebraic, or algorithmic?

---

## Core Expertise Areas

- **Logic**: propositional, predicate, proof techniques
- **Set Theory**: operations, relations, functions, cardinality
- **Combinatorics**: counting, permutations, combinations, inclusion-exclusion
- **Advanced Counting**: generating functions, Stirling numbers, partitions
- **Graph Theory**: paths, trees, planarity, coloring, matchings
- **Recurrence Relations**: solving, characteristic equations, generating functions
- **Discrete Probability**: sample spaces, distributions, expectation
- **Boolean Algebra**: logic circuits, normal forms, Karnaugh maps

---

## Logic

### Propositional Logic
```
Connectives:
  ¬p (not), p∧q (and), p∨q (or), p→q (implies), p↔q (iff)
  p→q ≡ ¬p∨q  (implication as disjunction)
  ¬(p∧q) ≡ ¬p∨¬q, ¬(p∨q) ≡ ¬p∧¬q  (De Morgan's)

Truth table analysis:
  p→q: only false when p true, q false
  Contrapositive: p→q ≡ ¬q→¬p  (logically equivalent!)
  Converse: q→p  (NOT equivalent to p→q)
  Inverse: ¬p→¬q  (NOT equivalent)

Tautology: true for all assignments (p∨¬p)
Contradiction: false for all (p∧¬p)
Contingency: neither

Important equivalences:
  Idempotent:    p∧p ≡ p, p∨p ≡ p
  Commutative:   p∧q ≡ q∧p
  Associative:   (p∧q)∧r ≡ p∧(q∧r)
  Distributive:  p∧(q∨r) ≡ (p∧q)∨(p∧r)
  Absorption:    p∧(p∨q) ≡ p
  Double neg:    ¬(¬p) ≡ p
```

### Predicate Logic & Proof Techniques
```
Quantifiers:
  ∀x P(x): for all x, P(x) is true
  ∃x P(x): there exists x such that P(x)
  Negation: ¬∀x P(x) ≡ ∃x ¬P(x)
            ¬∃x P(x) ≡ ∀x ¬P(x)

Proof techniques:
  Direct: assume hypothesis, derive conclusion
  Contrapositive: prove ¬q→¬p instead of p→q
  Contradiction: assume ¬p, derive contradiction → p true
  Cases: split into exhaustive cases, prove each
  Induction: base case + inductive step
  Construction: prove existence by building example
  Counterexample: disprove universal claim

Mathematical induction:
  Base case: P(n₀)
  Inductive step: P(k) → P(k+1)
  Conclusion: P(n) for all n ≥ n₀

Strong induction:
  Assume P(n₀),...,P(k) all hold → P(k+1)
  Useful for recursively defined sequences
  Well-ordering principle: every nonempty set of positive integers has minimum
```

---

## Set Theory
```
Set operations:
  A∪B: union, A∩B: intersection, A\B: difference, Aᶜ: complement
  A×B: Cartesian product {(a,b): a∈A, b∈B}
  P(A): power set {S: S⊆A}, |P(A)| = 2^|A|

Set identities (De Morgan's, distributive, etc.):
  A∩(B∪C) = (A∩B)∪(A∩C)
  A∪(B∩C) = (A∪B)∩(A∪C)
  (A∪B)ᶜ = Aᶜ∩Bᶜ, (A∩B)ᶜ = Aᶜ∪Bᶜ

Relations on A:
  Binary relation R ⊆ A×A
  Reflexive: aRa for all a
  Symmetric: aRb → bRa
  Antisymmetric: aRb and bRa → a=b
  Transitive: aRb and bRc → aRc

Equivalence relation: reflexive + symmetric + transitive
  Partitions set into equivalence classes [a] = {b: aRb}

Partial order: reflexive + antisymmetric + transitive
  Total order: also comparable (a≤b or b≤a)
  Well-order: total order + every nonempty subset has minimum

Functions:
  Injective (1-1): f(a)=f(b) → a=b
  Surjective (onto): ∀b ∃a: f(a)=b
  Bijective: injective and surjective
  Inverse exists ↔ bijective

Cardinality:
  |A|=|B|: bijection exists (A and B equinumerous)
  Countable: bijection with ℕ (or finite)
  ℤ, ℚ countable; ℝ uncountable (Cantor diagonal)
  |P(A)| > |A| for all A (Cantor's theorem)
  Schröder-Bernstein: injections both ways → bijection
```

---

## Combinatorics

### Basic Counting
```python
def counting_principles():
    return {
        'Multiplication rule': {
            'statement':    'k tasks, nᵢ ways for task i: n₁×n₂×...×nₖ total',
            'example':      '3 shirts × 4 pants = 12 outfits'
        },
        'Addition rule': {
            'statement':    'Mutually exclusive tasks: n₁+n₂+... total',
            'example':      'Travel by car OR plane: 3+5=8 options'
        },
        'Permutations': {
            'P(n,r)':       'n!/(n-r)! ordered arrangements of r from n',
            'all':          'n! ways to arrange all n objects',
            'with_repeats': 'n!/(n₁!n₂!...nₖ!) multinomial coefficient',
            'example':      'P(10,3) = 10×9×8 = 720'
        },
        'Combinations': {
            'C(n,r)':       'n!/(r!(n-r)!) unordered subsets of size r',
            'notation':     'C(n,r) = (n choose r) = ⁿCᵣ',
            'symmetry':     'C(n,r) = C(n,n-r)',
            'Pascals':      'C(n,r) = C(n-1,r-1) + C(n-1,r)',
            'example':      'C(10,3) = 120'
        },
        'Binomial theorem': {
            'formula':      '(x+y)ⁿ = Σₖ C(n,k) xᵏ yⁿ⁻ᵏ',
            'corollary':    '2ⁿ = Σₖ C(n,k) (x=y=1)',
            'corollary2':   '0 = Σₖ (-1)ᵏ C(n,k) (x=1,y=-1)'
        }
    }
```

### Inclusion-Exclusion & Pigeonhole
```
Inclusion-Exclusion Principle:
  |A∪B| = |A| + |B| - |A∩B|
  |A∪B∪C| = |A|+|B|+|C| - |A∩B| - |A∩C| - |B∩C| + |A∩B∩C|
  General: |∪ᵢAᵢ| = Σ|Aᵢ| - Σ|Aᵢ∩Aⱼ| + Σ|Aᵢ∩Aⱼ∩Aₖ| - ...

Derangements (no fixed points):
  D(n) = n! Σₖ₌₀ⁿ (-1)ᵏ/k! ≈ n!/e
  D(1)=0, D(2)=1, D(3)=2, D(4)=9, D(5)=44
  P(no fixed point) → 1/e ≈ 0.368 as n→∞

Pigeonhole Principle:
  n+1 objects in n holes → some hole has ≥ 2 objects
  Generalized: ⌈m/n⌉ objects in some hole when m objects in n holes
  
Applications:
  5 cards from 52: two have same suit (4 suits, 5 cards)
  367 people: two share birthday
  n+1 integers from {1,...,2n}: two are consecutive
  At NYC party of 1000: 3 people share same birthday
```

### Stars and Bars
```
Number of ways to place k identical balls in n distinct boxes:
  Without restriction: C(n+k-1, k) = C(n+k-1, n-1)
  Each box at least 1: C(k-1, n-1)  (requires k ≥ n)

Equivalent: non-negative integer solutions to x₁+x₂+...+xₙ = k
  Solutions: C(n+k-1, k)
  Positive solutions (each ≥ 1): C(k-1, n-1)

Example: distribute 10 identical candies to 4 children
  Any amount: C(13,3) = 286
  Each gets at least 1: C(9,3) = 84
```

---

## Advanced Counting
```python
def advanced_counting():
    return {
        'Stirling numbers (second kind) S(n,k)': {
            'definition':   'Ways to partition n elements into k nonempty subsets',
            'recurrence':   'S(n,k) = k·S(n-1,k) + S(n-1,k-1)',
            'boundary':     'S(n,1)=1, S(n,n)=1, S(n,0)=[n=0]',
            'example':      'S(4,2)=7: {1234}→{12}{34},{13}{24},{14}{23},{1}{234},{2}{134},{3}{124},{4}{123}'
        },
        'Stirling numbers (first kind) s(n,k)': {
            'definition':   'Permutations of n with exactly k cycles',
            'recurrence':   's(n,k) = s(n-1,k-1) + (n-1)s(n-1,k)',
            'example':      's(4,2)=11'
        },
        'Bell numbers Bₙ': {
            'definition':   'Total partitions of n-element set: Bₙ = Σₖ S(n,k)',
            'values':       'B₀=1, B₁=1, B₂=2, B₃=5, B₄=15, B₅=52',
            'triangle':     'Bell triangle: each row computed from previous'
        },
        'Catalan numbers Cₙ': {
            'formula':      'Cₙ = C(2n,n)/(n+1) = C(2n,n) - C(2n,n+1)',
            'values':       '1,1,2,5,14,42,132,...',
            'interpretations': [
                'Triangulations of (n+2)-gon',
                'Full binary trees with n+1 leaves',
                'Balanced parenthesizations with n pairs',
                'Lattice paths from (0,0) to (n,n) not crossing diagonal',
                'Mountains from 2n steps U/D not going below start'
            ]
        },
        'Integer partitions p(n)': {
            'definition':   'Ways to write n as sum of positive integers (order irrelevant)',
            'values':       'p(1)=1, p(2)=2, p(3)=3, p(4)=5, p(5)=7, p(6)=11',
            'generating':   'Σₙ p(n)xⁿ = Π_{k≥1} 1/(1-xᵏ)',
            'Euler':        'p(n) - p(n-1) - p(n-2) + p(n-5) + p(n-7) - ... = 0'
        }
    }

def generating_functions():
    return {
        'OGF (ordinary)': {
            'definition':   'A(x) = Σ aₙxⁿ encodes sequence {aₙ}',
            'shift':        'xA(x) = Σ aₙxⁿ⁺¹ shifts right',
            'OGF of (n choose k)': '(1+x)ⁿ = Σ C(n,k)xᵏ',
            'OGF of 1':     '1/(1-x) = Σ xⁿ',
            'multiplication': 'A(x)B(x) = Σ(Σ aₖbₙ₋ₖ)xⁿ (convolution)'
        },
        'EGF (exponential)': {
            'definition':   'Â(x) = Σ aₙxⁿ/n!',
            'use':          'Better for labeled structures',
            'EGF of 1':     'eˣ = Σ xⁿ/n!',
            'multiplication': 'Â(x)B̂(x) = Σ(Σ C(n,k)aₖbₙ₋ₖ)xⁿ/n!'
        },
        'Solving recurrences': {
            'method': [
                '1. Write recurrence as equation for A(x)',
                '2. Solve for A(x) algebraically',
                '3. Use partial fractions to get closed form',
                '4. Extract coefficients'
            ],
            'Fibonacci': 'A(x) = x/(1-x-x²) = 1/√5[1/(1-φx) - 1/(1-ψx)]',
            'result':    'Fₙ = (φⁿ-ψⁿ)/√5 where φ=(1+√5)/2, ψ=(1-√5)/2'
        }
    }
```

---

## Graph Theory
```
Graph G = (V, E):
  V: vertices, E: edges (pairs of vertices)
  Simple: no self-loops, no multi-edges
  Directed (digraph): edges have direction
  Weighted: edges have weights

Terminology:
  Degree deg(v): number of edges incident to v
  Handshaking lemma: Σ deg(v) = 2|E|  (sum of degrees = twice edges)
  Regular graph: all vertices same degree (k-regular)
  Complete graph Kₙ: all possible edges, |E| = C(n,2)
  Bipartite: V = A∪B, edges only between A and B

Paths and cycles:
  Walk: sequence of vertices connected by edges
  Path: walk with no repeated vertices
  Cycle: closed path (start = end, no repeats)
  Eulerian path: visits every edge exactly once
    Exists ↔ exactly 0 or 2 vertices of odd degree
  Eulerian circuit: closed Eulerian path
    Exists ↔ all vertices even degree AND connected
  Hamiltonian path: visits every vertex exactly once (NP-hard to find)

Connectivity:
  Connected: path between every pair of vertices
  k-connected: removing any k-1 vertices leaves connected graph
  Bridge: edge whose removal disconnects graph
  Cut vertex: vertex whose removal disconnects graph

Trees:
  Connected acyclic graph
  n vertices, n-1 edges (equivalent characterization)
  Unique path between any two vertices
  Spanning tree: subgraph that is a tree and includes all vertices
  Cayley's formula: Kₙ has n^(n-2) spanning trees

Special graphs:
  Path Pₙ, Cycle Cₙ, Complete Kₙ, Complete bipartite Kₘₙ
  Petersen graph: 3-regular, 10 vertices, 15 edges (many extremal properties)
  Hypercube Qₙ: n-dimensional, 2ⁿ vertices
```
```python
def graph_theory_algorithms():
    return {
        'BFS (Breadth-First Search)': {
            'complexity':   'O(V+E)',
            'use':          'Shortest path (unweighted), connected components',
            'visits':       'Level by level from source'
        },
        'DFS (Depth-First Search)': {
            'complexity':   'O(V+E)',
            'use':          'Topological sort, cycle detection, SCCs',
            'visits':       'As deep as possible before backtracking'
        },
        'Dijkstra (shortest path)': {
            'complexity':   'O((V+E)log V) with priority queue',
            'use':          'Single-source shortest paths, non-negative weights',
            'greedy':       'Always process vertex with minimum distance'
        },
        'Kruskal (MST)': {
            'complexity':   'O(E log E)',
            'method':       'Sort edges, add if no cycle (union-find)',
            'greedy':       'Globally optimal by matroid theory'
        },
        'Prim (MST)': {
            'complexity':   'O(E log V)',
            'method':       'Grow tree greedily from starting vertex'
        }
    }

def graph_coloring():
    return {
        'Chromatic number χ(G)': {
            'definition':   'Minimum colors to color vertices (adjacent ≠ color)',
            'bipartite':    'χ = 2 iff G bipartite (no odd cycles)',
            'upper_bound':  'χ ≤ Δ+1 (Δ = max degree)',
            'Brookstheorem':'χ ≤ Δ except Kₙ and odd cycles'
        },
        'Four Color Theorem': {
            'statement':    'Every planar graph is 4-colorable',
            'proof':        'Appel & Haken 1976 (computer-assisted)',
            'significance': 'First major theorem proved by computer'
        },
        'Chromatic polynomial P(G,k)': {
            'definition':   'Number of proper colorings with exactly k colors',
            'deletion-contraction': 'P(G,k) = P(G-e,k) - P(G/e,k)'
        }
    }

def planarity():
    return {
        'Euler formula':        'V - E + F = 2 for connected planar graph (F=faces)',
        'Corollary':            'E ≤ 3V-6 for simple planar graphs (V≥3)',
        'Kuratowski theorem':   'G planar ↔ no subdivision of K₅ or K₃₃',
        'Wagner theorem':       'G planar ↔ no K₅ or K₃₃ as minor',
        'K₅':                   '5 vertices, 10 edges — not planar',
        'K₃₃':                  '6 vertices, 9 edges — not planar'
    }
```

---

## Recurrence Relations
```
Linear recurrence with constant coefficients:
  aₙ = c₁aₙ₋₁ + c₂aₙ₋₂ + ... + cₖaₙ₋ₖ

Characteristic equation:
  rᵏ = c₁rᵏ⁻¹ + ... + cₖ

Solution:
  Distinct roots r₁,...,rₖ: aₙ = A₁r₁ⁿ + A₂r₂ⁿ + ... + Aₖrₖⁿ
  Repeated root r (multiplicity m): (A₀ + A₁n + ... + Aₘ₋₁nᵐ⁻¹)rⁿ
  Complex roots: write as real sinusoidal form

Fibonacci sequence: aₙ = aₙ₋₁ + aₙ₋₂, a₁=a₂=1
  Characteristic: r² = r+1 → r = (1±√5)/2
  Solution: Fₙ = (φⁿ - ψⁿ)/√5  (Binet's formula)
  φ = (1+√5)/2 ≈ 1.618 (golden ratio)

Non-homogeneous: aₙ = c₁aₙ₋₁+...+f(n)
  Particular solution method (similar to ODEs)
  f(n) = polynomial → try polynomial
  f(n) = αⁿ → try Cαⁿ (or Cnαⁿ if α is characteristic root)

Master theorem (divide & conquer):
  T(n) = aT(n/b) + f(n)  (a≥1, b>1)
  Let c = log_b(a):
  f(n) = O(nᶜ⁻ᵉ) → T(n) = Θ(nᶜ)
  f(n) = Θ(nᶜ) → T(n) = Θ(nᶜ log n)
  f(n) = Ω(nᶜ⁺ᵉ) → T(n) = Θ(f(n))
  Binary search: T(n)=T(n/2)+1 → O(log n)
  Merge sort: T(n)=2T(n/2)+n → O(n log n)
```

---

## Discrete Probability
```
Sample space Ω, event A ⊆ Ω
Uniform probability: P(A) = |A|/|Ω|

Conditional probability: P(A|B) = P(A∩B)/P(B)
Independence: P(A∩B) = P(A)P(B)
Bayes: P(A|B) = P(B|A)P(A)/P(B)

Discrete random variable X: function Ω → ℝ
Expected value: E[X] = Σ x·P(X=x)
Variance: Var(X) = E[(X-μ)²] = E[X²] - (E[X])²
Linearity: E[aX+bY] = aE[X]+bE[Y]  (always)

Important discrete distributions:
  Bernoulli(p): P(X=1)=p, E=p, Var=p(1-p)
  Binomial(n,p): P(X=k)=C(n,k)pᵏ(1-p)^(n-k), E=np, Var=np(1-p)
  Geometric(p): P(X=k)=p(1-p)^(k-1), E=1/p, Var=(1-p)/p²
  Poisson(λ): P(X=k)=e^(-λ)λᵏ/k!, E=Var=λ

Markov inequality: P(X≥a) ≤ E[X]/a (X≥0, a>0)
Chebyshev: P(|X-μ|≥kσ) ≤ 1/k²
Chernoff bounds: tighter bounds for sums of independent variables

Linearity of expectation (powerful!):
  E[Σ Xᵢ] = Σ E[Xᵢ]  EVEN if Xᵢ are dependent
  Example: E[number of fixed points in random permutation] = 1
```

---

## Boolean Algebra
```
Boolean algebra: {0,1} with +, ·, complement
  Sum: + (OR), Product: · (AND), Complement: ¯ (NOT)
  0+0=0, 0+1=1, 1+1=1 (OR)
  0·0=0, 0·1=0, 1·1=1 (AND)
  0̄=1, 1̄=0 (NOT)

Laws (same as set theory):
  Idempotent: x+x=x, x·x=x
  Null: x+1=1, x·0=0
  Identity: x+0=x, x·1=x
  Complement: x+x̄=1, x·x̄=0
  De Morgan: (x+y)¯=x̄·ȳ, (x·y)¯=x̄+ȳ

Normal forms:
  Minterm: product term with each variable complemented or not
  Maxterm: sum term with each variable complemented or not
  DNF (SOP): sum of products (OR of ANDs)
  CNF (POS): product of sums (AND of ORs)
  Every function representable in DNF and CNF

Karnaugh maps:
  Visual simplification of boolean expressions
  Group adjacent 1s in powers of 2 (1,2,4,8,...)
  Groups can wrap around edges
  Goal: fewest, largest groups for minimal expression

Logic gates: AND, OR, NOT, NAND, NOR, XOR, XNOR
  NAND and NOR are functionally complete (can build all others)
  XOR: x⊕y = xy̅+x̅y  (parity function)
```

---

## Common Pitfalls

| Pitfall | Fix |
|---|---|
| Counting ordered when unordered needed | Check if order matters: permutation (yes) vs combination (no) |
| Forgetting empty set in inclusion-exclusion | Careful with alternating signs in large inclusion-exclusion |
| Stars and bars with restrictions | Use inclusion-exclusion on top of stars and bars |
| Tree has n-1 edges always | Only for simple trees; spanning tree of n vertices has n-1 edges |
| Eulerian = Hamiltonian | Eulerian: edges; Hamiltonian: vertices — very different difficulty! |
| E[X²] = (E[X])² | Var(X) = E[X²]-(E[X])² ≥ 0 so E[X²] ≥ (E[X])² always |

---

## Related Skills

- **graph-theory-expert**: Deeper graph theory
- **number-theory-expert**: Number theory tools
- **probability-expert**: Continuous probability
- **abstract-algebra-expert**: Algebraic structures
- **algorithms-expert**: Graph algorithms, complexity
- **linear-algebra-expert**: Linear algebra over finite fields
