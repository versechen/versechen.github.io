---
name: Python Patterns
description: Python 设计模式与惯用法合集，覆盖创建型、结构型与行为型模式。
icon: 🐍
tags: [Python, 设计模式]
status: active
github: https://github.com/versechen/python-patterns
order: 4
hasDocs: false
---

# python-patterns

A collection of design patterns and idioms in Python.

## Creational Patterns

| Pattern | Description |
| --- | --- |
| abstract_factory | use a generic function with specific factories |
| borg | a singleton with shared-state among instances |
| builder | builder object receives parameters and returns constructed objects |
| factory | delegate a specialized function/method to create instances |
| lazy_evaluation | lazily-evaluated property pattern in Python |
| pool | preinstantiate and maintain a group of instances |
| prototype | use a factory and clones of a prototype for new instances |

## Structural Patterns

| Pattern | Description |
| --- | --- |
| 3-tier | data ↔ business logic ↔ presentation separation |
| adapter | adapt one interface to another using a white-list |
| bridge | a client-provider middleman to soften interface changes |
| composite | treat individual objects and compositions uniformly |
| decorator | wrap functionality with other functionality |
| facade | use one class as an API to a number of others |
| flyweight | transparently reuse existing instances |
| mvc | model ↔ view ↔ controller |
| proxy | an object funnels operations to something else |

## Behavioral Patterns

涵盖 chain of responsibility、command、iterator、observer、strategy、template、visitor 等常见行为型模式。完整源码见 GitHub 仓库。
