export default function MyReactComponent(props) {
    return (
      <aside>
        <header>{props.title}</header>
        <main>{props.children}</main>
        <footer>{props.socialLinks}</footer>
      </aside>
    )
  }